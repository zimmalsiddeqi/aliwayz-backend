'use strict';

const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

const UserRepository = require('./user.repository');
const AuthRepository = require('../auth/auth.repository');
const BadgeEngine = require('../badges/badge.engine');

const appConfig = require('../../config/app.config');
const logger = require('../../shared/utils/logger');

const AppError = require('../../shared/errors/AppError');
const NotFoundError = require('../../shared/errors/NotFoundError');

const { CACHE_KEYS, CACHE_TTL } = require('../../shared/constants/cacheKeys');
const { ROLES, SELLER_ROLES } = require('../../shared/constants/roles');
const { getPaginationParams } = require('../../shared/utils/paginate');
const constants = require('../../config/constants');

class UserService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new UserRepository(supabase);
    this.authRepo = new AuthRepository(supabase);
    this.badgeEngine = new BadgeEngine(supabase, redis);
  }

  // ─────────────────────────────────────────
  // GET OWN PROFILE
  // ─────────────────────────────────────────
  async getMyProfile(userId) {
    const profile = await this.repo.getMyProfile(userId);
    if (!profile) throw new NotFoundError('User');

    // Filter only active badges for response
    if (profile.user_badges) {
      profile.user_badges = profile.user_badges.filter((ub) => ub.is_active);
    }

    return profile;
  }

  // ─────────────────────────────────────────
  // GET PUBLIC PROFILE
  // ─────────────────────────────────────────
  async getPublicProfile(username) {
    const cacheKey = CACHE_KEYS.USER_PROFILE(username);

    // Check cache
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const profile = await this.repo.getPublicProfile(username);
    if (!profile) throw new NotFoundError('User');

    // Filter active badges only
    if (profile.user_badges) {
      profile.user_badges = profile.user_badges.filter((ub) => ub.is_active);
    }

    // Cache the public profile
    await this.redis.set(cacheKey, profile, CACHE_TTL.USER_PROFILE);

    return profile;
  }

  // ─────────────────────────────────────────
  // UPDATE PROFILE
  // ─────────────────────────────────────────
  async updateProfile(userId, data) {
    // If changing username, check uniqueness
    if (data.username) {
      const taken = await this.repo.isUsernameTaken(data.username, userId);
      if (taken) {
        throw new AppError('Username is already taken', 409, 'USERNAME_TAKEN');
      }
    }

    const updated = await this.repo.updateProfile(userId, data);

    // Invalidate caches
    await this.redis.del(CACHE_KEYS.USER_PROFILE(updated.username));

    return updated;
  }

  // ─────────────────────────────────────────
  // UPLOAD AVATAR
  // Processes image with sharp, uploads to Supabase Storage
  // ─────────────────────────────────────────
  async uploadAvatar(userId, fileBuffer, mimetype, originalUsername) {
    // Validate file type
    if (!constants.ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      throw new AppError(
        'Invalid file type. Only JPEG, PNG, and WebP are allowed.',
        400,
        'INVALID_FILE_TYPE'
      );
    }

    // Validate file size (10MB max)
    if (fileBuffer.length > constants.MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      throw new AppError(
        `File too large. Maximum size is ${constants.MAX_IMAGE_SIZE_MB}MB.`,
        400,
        'FILE_TOO_LARGE'
      );
    }

    // Process image — resize to 400x400 and convert to WebP for optimization
    let processedBuffer;
    try {
      processedBuffer = await sharp(fileBuffer)
        .resize(400, 400, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch (err) {
      logger.error({ err }, 'Image processing failed');
      throw new AppError('Failed to process image', 400, 'IMAGE_PROCESSING_FAILED');
    }

    // Generate unique file path
    const fileName = `avatars/${userId}/${uuidv4()}.webp`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } =
      await this.supabase.storage
        .from(appConfig.storage.bucket)
        .upload(fileName, processedBuffer, {
          contentType: 'image/webp',
          upsert: true, // Overwrite if same path
          cacheControl: '3600',
        });

    if (uploadError) {
      logger.error({ uploadError }, 'Avatar upload to Supabase Storage failed');
      throw new AppError('Failed to upload avatar', 500);
    }

    // Build CDN URL
    const storageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${appConfig.storage.bucket}/${fileName}`;
    const cdnUrl = appConfig.cdn.baseUrl
      ? `${appConfig.cdn.baseUrl}/${appConfig.storage.bucket}/${fileName}`
      : storageUrl;

    // Update user record
    const updated = await this.repo.updateProfile(userId, {
      avatar_url: cdnUrl,
    });

    // Invalidate cache
    await this.redis.del(CACHE_KEYS.USER_PROFILE(originalUsername));

    logger.info({ userId, fileName }, 'Avatar uploaded successfully');

    return { avatar_url: cdnUrl };
  }

  // ─────────────────────────────────────────
  // UPDATE LOCATION
  // ─────────────────────────────────────────
  async updateLocation(userId, locationData) {
    const updated = await this.repo.updateProfile(userId, {
      location_city: locationData.location_city,
      location_lat: locationData.location_lat,
      location_lng: locationData.location_lng,
    });

    return {
      location_city: updated.location_city,
      message: 'Location updated successfully',
    };
  }

  // ─────────────────────────────────────────
  // UPDATE ROLE
  // ─────────────────────────────────────────
  async updateRole(userId, role) {
    // Initialize seller stats if becoming a seller
    if (SELLER_ROLES.includes(role)) {
      // Upsert — safe to call multiple times
      await this.supabase
        .from('seller_stats')
        .upsert({ user_id: userId }, { onConflict: 'user_id' });

      // Evaluate badges (may assign New Seller)
      await this.badgeEngine.evaluateAndAssignBadges(userId, 'role_updated');
    }

    const updated = await this.repo.updateProfile(userId, { role });
    logger.info({ userId, role }, 'User role updated');

    return updated;
  }

  // ─────────────────────────────────────────
  // UPDATE FCM TOKEN
  // ─────────────────────────────────────────
  async updateFcmToken(userId, fcmToken) {
    await this.repo.updateProfile(userId, { fcm_token: fcmToken });
    return { message: 'Push notification token updated' };
  }

  // ─────────────────────────────────────────
  // GET PURCHASE HISTORY
  // ─────────────────────────────────────────
  async getPurchaseHistory(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getPurchaseHistory(userId, {
      limit,
      offset,
    });

    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // GET FAVORITES
  // ─────────────────────────────────────────
  async getFavoriteProducts(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getFavoriteProducts(userId, {
      limit,
      offset,
    });

    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // GET FOLLOWING STORES
  // ─────────────────────────────────────────
  async getFollowingStores(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getFollowingStores(userId, {
      limit,
      offset,
    });

    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // DELETE ACCOUNT
  // ─────────────────────────────────────────
  async deleteAccount(userId, username) {
    // Revoke all auth tokens
    await this.authRepo.revokeAllUserRefreshTokens(userId);

    // Soft delete (anonymize PII)
    await this.repo.softDeleteUser(userId);

    // Invalidate all caches
    await this.redis.del(CACHE_KEYS.USER_PROFILE(username));
    await this.redis.del(CACHE_KEYS.USER_BADGES(userId));

    logger.info({ userId }, 'User account deleted');

    return { message: 'Account deleted successfully' };
  }
}

module.exports = UserService;