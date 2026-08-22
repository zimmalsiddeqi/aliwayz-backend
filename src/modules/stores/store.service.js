"use strict";

const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");

const StoreRepository = require("./store.repository");
const NotificationService = require("../notifications/notification.service");
const VerificationRepository = require("../verification/verification.repository");
const ManualVerificationProvider = require("../verification/verificationProvider.manual");
const VerificationEngine = require("../verification/verificationEngine");

const { createSlug } = require("../../shared/utils/slugify");
const { getPaginationParams } = require("../../shared/utils/paginate");
const { CACHE_KEYS, CACHE_TTL } = require("../../shared/constants/cacheKeys");
const { SELLER_ROLES } = require("../../shared/constants/roles");
const appConfig = require("../../config/app.config");
const constants = require("../../config/constants");
const logger = require("../../shared/utils/logger");

const AppError = require("../../shared/errors/AppError");
const NotFoundError = require("../../shared/errors/NotFoundError");
const ForbiddenError = require("../../shared/errors/ForbiddenError");

class StoreService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new StoreRepository(supabase);
    this.notificationService = new NotificationService(supabase, redis);
    
    this.verificationRepo = new VerificationRepository(supabase);
    const manualProvider = new ManualVerificationProvider(supabase, this.verificationRepo);
    this.verificationEngine = new VerificationEngine(manualProvider);
  }

  // ─────────────────────────────────────────
  // CREATE STORE
  // One store per user — enforce strictly
  // ─────────────────────────────────────────
  async createStore(userId, userRole, data) {
    // Validate user has seller capabilities
    if (!SELLER_ROLES.includes(userRole)) {
      throw new ForbiddenError(
        "You need a seller account to create a store. Update your role first.",
      );
    }

    // Clean up store draft if one exists
    try {
      await this.verificationRepo.deleteStoreDraft(userId);
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to delete store draft upon store creation');
    }

    // Determine initial verification status based on user verification status
    const isVerified = await this.verificationEngine.isVerified(userId);

    // Enforce one store per user
    const existingStore = await this.repo.findStoreByUserId(userId);
    if (existingStore) {
      throw new AppError(
        "You already have a store. You can only have one store per account.",
        409,
        "STORE_EXISTS",
      );
    }

    const slug = createSlug(data.store_name);

    const store = await this.repo.createStore({
      user_id: userId,
      store_name: data.store_name,
      slug,
      description: data.description || null,
      category_id: data.category_id || null,
      location_city: data.location_city || null,
      location_lat: data.location_lat || null,
      location_lng: data.location_lng || null,
      social_instagram: data.social_instagram || null,
      social_facebook: data.social_facebook || null,
      social_tiktok: data.social_tiktok || null,
      is_verified: isVerified,
    });

    logger.info({ userId, storeId: store.id }, "Store created");

    return store;
  }

  // ─────────────────────────────────────────
  // GET STORE (Public)
  // ─────────────────────────────────────────
  async getStoreBySlug(slug) {
    const cacheKey = CACHE_KEYS.STORE(slug);

    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const store = await this.repo.findStoreBySlug(slug);
    if (!store) throw new NotFoundError("Store");

    await this.redis.set(cacheKey, store, CACHE_TTL.STORE);

    return store;
  }

  // ─────────────────────────────────────────
  // GET MY STORE (current user's store)
  // ─────────────────────────────────────────
  async getMyStore(userId) {
    const store = await this.repo.findStoreByUserId(userId);
    if (!store) return null;

    // Get full store details
    const fullStore = await this.repo.findStoreById(store.id);
    return fullStore;
  }

  // ─────────────────────────────────────────
  // UPDATE STORE
  // ─────────────────────────────────────────
  async updateStore(userId, storeId, data) {
    const store = await this.repo.findStoreById(storeId);
    if (!store) throw new NotFoundError("Store");

    // Ownership check
    if (store.user_id !== userId) {
      throw new ForbiddenError("You do not own this store");
    }

    const updated = await this.repo.updateStore(storeId, data);

    // Invalidate cache
    await this.redis.del(CACHE_KEYS.STORE(store.slug));
    if (updated.slug !== store.slug) {
      await this.redis.del(CACHE_KEYS.STORE(updated.slug));
    }

    return updated;
  }

  // ─────────────────────────────────────────
  // UPLOAD STORE LOGO
  // ─────────────────────────────────────────
  async uploadLogo(userId, storeId, fileBuffer, mimetype) {
    const store = await this.repo.findStoreById(storeId);
    if (!store) throw new NotFoundError("Store");
    if (store.user_id !== userId)
      throw new ForbiddenError("You do not own this store");

    if (!constants.ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      throw new AppError("Invalid file type", 400, "INVALID_FILE_TYPE");
    }

    const processedBuffer = await sharp(fileBuffer)
      .resize(300, 300, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();

    const fileName = `stores/${storeId}/logo/${uuidv4()}.webp`;

    const { error: uploadError } = await this.supabase.storage
      .from(appConfig.storage.bucket)
      .upload(fileName, processedBuffer, {
        contentType: "image/webp",
        upsert: true,
      });

    if (uploadError) {
      logger.error({ uploadError }, "Store logo upload failed");
      throw new AppError("Failed to upload logo", 500);
    }

    const cdnUrl = appConfig.cdn.baseUrl
      ? `${appConfig.cdn.baseUrl}/${appConfig.storage.bucket}/${fileName}`
      : `${process.env.SUPABASE_URL}/storage/v1/object/public/${appConfig.storage.bucket}/${fileName}`;

    await this.repo.updateStore(storeId, { logo_url: cdnUrl });
    await this.redis.del(CACHE_KEYS.STORE(store.slug));

    return { logo_url: cdnUrl };
  }

  // ─────────────────────────────────────────
  // UPLOAD STORE BANNER
  // ─────────────────────────────────────────
  async uploadBanner(userId, storeId, fileBuffer, mimetype) {
    const store = await this.repo.findStoreById(storeId);
    if (!store) throw new NotFoundError("Store");
    if (store.user_id !== userId)
      throw new ForbiddenError("You do not own this store");

    if (!constants.ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      throw new AppError("Invalid file type", 400, "INVALID_FILE_TYPE");
    }

    // Banner: wider aspect ratio 1200x400
    const processedBuffer = await sharp(fileBuffer)
      .resize(1200, 400, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();

    const fileName = `stores/${storeId}/banner/${uuidv4()}.webp`;

    const { error: uploadError } = await this.supabase.storage
      .from(appConfig.storage.bucket)
      .upload(fileName, processedBuffer, {
        contentType: "image/webp",
        upsert: true,
      });

    if (uploadError) {
      logger.error({ uploadError }, "Store banner upload failed");
      throw new AppError("Failed to upload banner", 500);
    }

    const cdnUrl = appConfig.cdn.baseUrl
      ? `${appConfig.cdn.baseUrl}/${appConfig.storage.bucket}/${fileName}`
      : `${process.env.SUPABASE_URL}/storage/v1/object/public/${appConfig.storage.bucket}/${fileName}`;

    await this.repo.updateStore(storeId, { banner_url: cdnUrl });
    await this.redis.del(CACHE_KEYS.STORE(store.slug));

    return { banner_url: cdnUrl };
  }

  // ─────────────────────────────────────────
  // GET STORE PRODUCTS
  // ─────────────────────────────────────────
  async getStoreProducts(slug, query, requestingUserId = null) {
    const store = await this.repo.findStoreBySlug(slug);
    if (!store) throw new NotFoundError("Store");

    const { page, limit, offset } = getPaginationParams(query);

    // Only store owner can filter by all statuses
    const isOwner = requestingUserId === store.users?.id;
    const status = isOwner && query.status ? query.status : "available";

    const { data, count } = await this.repo.getStoreProducts(store.id, {
      limit,
      offset,
      status,
    });

    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // GET STORE ANALYTICS (Owner only)
  // ─────────────────────────────────────────
  async getStoreAnalytics(userId, storeId) {
    const store = await this.repo.findStoreById(storeId);
    if (!store) throw new NotFoundError("Store");
    if (store.user_id !== userId) throw new ForbiddenError("Access denied");

    return this.repo.getStoreAnalytics(storeId, userId);
  }

  // ─────────────────────────────────────────
  // FOLLOW STORE
  // ─────────────────────────────────────────
  async followStore(followerId, storeSlug) {
    const store = await this.repo.findStoreBySlug(storeSlug);
    if (!store) throw new NotFoundError("Store");

    if (store.users?.id === followerId) {
      throw new AppError("You cannot follow your own store", 400);
    }

    const alreadyFollowing = await this.repo.isFollowing(followerId, store.id);
    if (alreadyFollowing) {
      throw new AppError("You are already following this store", 409);
    }

    await this.repo.followStore(followerId, store.id);

    // Invalidate store cache (follower count changed)
    await this.redis.del(CACHE_KEYS.STORE(storeSlug));

    // Send notification to store owner
    await this.notificationService.createNotification({
      userId: store.users.id,
      type: "new_follower",
      title: "New Follower",
      body: `Someone started following your store ${store.store_name}`,
      data: { storeId: store.id, storeSlug },
    });

    return { message: "Store followed successfully" };
  }

  // ─────────────────────────────────────────
  // UNFOLLOW STORE
  // ─────────────────────────────────────────
  async unfollowStore(followerId, storeSlug) {
    const store = await this.repo.findStoreBySlug(storeSlug);
    if (!store) throw new NotFoundError("Store");

    await this.repo.unfollowStore(followerId, store.id);
    await this.redis.del(CACHE_KEYS.STORE(storeSlug));

    return { message: "Store unfollowed successfully" };
  }

  // ─────────────────────────────────────────
  // GET STORE FOLLOWERS
  // ─────────────────────────────────────────
  async getStoreFollowers(storeId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getStoreFollowers(storeId, {
      limit,
      offset,
    });

    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // DELETE STORE
  // ─────────────────────────────────────────
  async deleteStore(userId, storeId) {
    const store = await this.repo.findStoreById(storeId);
    if (!store) throw new NotFoundError("Store");
    if (store.user_id !== userId)
      throw new ForbiddenError("You do not own this store");

    await this.repo.softDeleteStore(storeId);
    await this.redis.del(CACHE_KEYS.STORE(store.slug));

    logger.info({ userId, storeId }, "Store deleted");

    return { message: "Store deleted successfully" };
  }
}

module.exports = StoreService;
