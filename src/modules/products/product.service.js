'use strict';

const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const path = require('path');

const ProductRepository = require('./product.repository');
const NotificationService = require('../notifications/notification.service');

const { createSlug } = require('../../shared/utils/slugify');
const { getPaginationParams } = require('../../shared/utils/paginate');
const { CACHE_KEYS, CACHE_TTL } = require('../../shared/constants/cacheKeys');
const { SELLER_ROLES } = require('../../shared/constants/roles');
const { PRODUCT_STATUS } = require('../../shared/constants/productStatus');
const { containsProfanity } = require('../../shared/utils/profanityFilter');
const appConfig = require('../../config/app.config');
const constants = require('../../config/constants');
const logger = require('../../shared/utils/logger');

const AppError = require('../../shared/errors/AppError');
const NotFoundError = require('../../shared/errors/NotFoundError');
const ForbiddenError = require('../../shared/errors/ForbiddenError');

class ProductService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new ProductRepository(supabase);
    this.notificationService = new NotificationService(supabase, redis);
  }

  // ─────────────────────────────────────────
  // CREATE PRODUCT LISTING
  // ─────────────────────────────────────────
  async createProduct(sellerId, storeId, userRole, data) {
    if (!SELLER_ROLES.includes(userRole)) {
      throw new ForbiddenError('Seller account required to list products');
    }

    // Content moderation
    if (data.title && containsProfanity(data.title)) {
      throw new AppError('Title contains prohibited content', 400, 'PROFANITY_DETECTED');
    }

    if (data.description && containsProfanity(data.description)) {
      throw new AppError(
        'Description contains prohibited content',
        400,
        'PROFANITY_DETECTED'
      );
    }

    const slug = createSlug(data.title);

    const product = await this.repo.createProduct({
      seller_id: sellerId,
      store_id: storeId,
      category_id: data.category_id,
      title: data.title,
      slug,
      description: data.description || null,
      price: data.price,
      currency: data.currency || 'USD',
      condition: data.condition,
      brand: data.brand || null,
      color: data.color || null,
      quantity: data.quantity || 1,
      status: data.status || PRODUCT_STATUS.AVAILABLE,
      location_city: data.location_city || null,
      location_lat: data.location_lat || null,
      location_lng: data.location_lng || null,
    });

    // Update seller stats
    await this.repo.refreshSellerStats(sellerId);

    // Invalidate feed caches (new product affects recent/trending)
    await this.redis.del(CACHE_KEYS.TRENDING_FEED);
    await this.redis.del(CACHE_KEYS.RECENT_FEED);

    logger.info({ sellerId, productId: product.id }, 'Product created');

    return product;
  }

  // ─────────────────────────────────────────
  // GET PRODUCT DETAIL
  // ─────────────────────────────────────────
  async getProduct(productId, requestingUserId, ipAddress) {
    const cacheKey = CACHE_KEYS.PRODUCT(productId);

    let product = await this.redis.get(cacheKey);

    if (!product) {
      product = await this.repo.findProductById(productId);
      if (!product) throw new NotFoundError('Product');

      // Only cache available products
      if (product.status === PRODUCT_STATUS.AVAILABLE) {
        await this.redis.set(cacheKey, product, CACHE_TTL.PRODUCT);
      }
    }

    // Don't show hidden/draft products to non-owners
    if (
      [PRODUCT_STATUS.HIDDEN, PRODUCT_STATUS.DRAFT].includes(product.status) &&
      product.users?.id !== requestingUserId
    ) {
      throw new NotFoundError('Product');
    }

    // Record view asynchronously (non-blocking)
    // Dedup: one view per user/IP per hour via Redis
    this._recordViewWithDedup(
      product.id,
      requestingUserId,
      ipAddress
    ).catch((err) => logger.warn({ err }, 'View dedup failed'));

    // Attach favorite status if user is authenticated
    let is_favorited = false;
    if (requestingUserId) {
      is_favorited = await this.repo.isProductFavorited(
        requestingUserId,
        product.id
      );
    }

    return { ...product, is_favorited };
  }

  // ─────────────────────────────────────────
  // UPDATE PRODUCT
  // ─────────────────────────────────────────
  async updateProduct(sellerId, productId, data) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new NotFoundError('Product');

    // Ownership check
    if (product.users?.id !== sellerId) {
      throw new ForbiddenError('You do not own this product');
    }

    // Cannot update sold products
    if (product.status === PRODUCT_STATUS.SOLD) {
      throw new AppError('Cannot update a sold product', 400, 'PRODUCT_SOLD');
    }

    // Content moderation on updated fields
    if (data.title && containsProfanity(data.title)) {
      throw new AppError('Title contains prohibited content', 400, 'PROFANITY_DETECTED');
    }

    // Detect price change — notify favoriters
    const priceChanged =
      data.price !== undefined && data.price !== product.price;
    const oldPrice = product.price;

    const updated = await this.repo.updateProduct(productId, data);

    // Invalidate caches
    await this.redis.del(CACHE_KEYS.PRODUCT(productId));
    await this.redis.del(CACHE_KEYS.TRENDING_FEED);

    // Send price drop notifications asynchronously
    if (priceChanged && data.price < oldPrice) {
      this._notifyPriceChange(product, oldPrice, data.price).catch((err) =>
        logger.warn({ err }, 'Price change notification failed')
      );
    }

    return updated;
  }

  // ─────────────────────────────────────────
  // UPDATE PRODUCT STATUS
  // ─────────────────────────────────────────
  async updateProductStatus(sellerId, productId, newStatus) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new NotFoundError('Product');

    if (product.users?.id !== sellerId) {
      throw new ForbiddenError('You do not own this product');
    }

    // Cannot manually change SOLD status (only QR system can do this)
    if (newStatus === PRODUCT_STATUS.SOLD) {
      throw new AppError(
        'Product status can only be set to SOLD via QR verification',
        400,
        'INVALID_STATUS_TRANSITION'
      );
    }

    if (product.status === PRODUCT_STATUS.SOLD) {
      throw new AppError(
        'Cannot change status of a sold product',
        400,
        'PRODUCT_ALREADY_SOLD'
      );
    }

    const updated = await this.repo.updateProduct(productId, {
      status: newStatus,
    });

    await this.redis.del(CACHE_KEYS.PRODUCT(productId));

    // Update seller stats (active_listings count changes)
    await this.repo.refreshSellerStats(sellerId);

    return updated;
  }

  // ─────────────────────────────────────────
  // DELETE PRODUCT
  // ─────────────────────────────────────────
  async deleteProduct(sellerId, productId) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new NotFoundError('Product');

    if (product.users?.id !== sellerId) {
      throw new ForbiddenError('You do not own this product');
    }

    if (product.status === PRODUCT_STATUS.SOLD) {
      throw new AppError('Cannot delete a sold product', 400, 'PRODUCT_SOLD');
    }

    await this.repo.softDeleteProduct(productId);

    // Invalidate caches
    await this.redis.del(CACHE_KEYS.PRODUCT(productId));
    await this.redis.del(CACHE_KEYS.TRENDING_FEED);
    await this.redis.del(CACHE_KEYS.RECENT_FEED);

    // Update seller stats
    await this.repo.refreshSellerStats(sellerId);

    logger.info({ sellerId, productId }, 'Product deleted');

    return { message: 'Product deleted successfully' };
  }

  // ─────────────────────────────────────────
  // UPLOAD PRODUCT IMAGES (Multi-upload)
  // ─────────────────────────────────────────
  async uploadProductImages(sellerId, productId, files) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new NotFoundError('Product');

    if (product.users?.id !== sellerId) {
      throw new ForbiddenError('You do not own this product');
    }

    // Check existing image count
    const existingCount = await this.repo.countProductImages(productId);
    const remainingSlots = constants.MAX_PRODUCT_IMAGES - existingCount;

    if (remainingSlots <= 0) {
      throw new AppError(
        `Maximum ${constants.MAX_PRODUCT_IMAGES} images allowed per product`,
        400,
        'MAX_IMAGES_REACHED'
      );
    }

    if (files.length > remainingSlots) {
      throw new AppError(
        `You can only upload ${remainingSlots} more image(s)`,
        400,
        'TOO_MANY_IMAGES'
      );
    }

    const uploadedImages = [];
    let displayOrder = existingCount;

    for (const file of files) {
      if (!constants.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
        throw new AppError(
          `Invalid file type: ${file.mimetype}. Only JPEG, PNG, and WebP allowed.`,
          400,
          'INVALID_FILE_TYPE'
        );
      }

      if (file.buffer.length > constants.MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        throw new AppError(
          `File too large. Maximum ${constants.MAX_IMAGE_SIZE_MB}MB per image.`,
          400,
          'FILE_TOO_LARGE'
        );
      }

      // Process image — create two sizes: main (800px) and thumbnail (300px)
      const [mainBuffer, thumbBuffer] = await Promise.all([
        sharp(file.buffer)
          .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer(),
        sharp(file.buffer)
          .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer(),
      ]);

      const imageUuid = uuidv4();
      const fileName = `products/${productId}/${imageUuid}.webp`;
      const thumbFileName = `products/${productId}/thumbnails/${imageUuid}.webp`;

      // Upload main image
      const { error: uploadError } = await this.supabase.storage
        .from(appConfig.storage.bucket)
        .upload(fileName, mainBuffer, {
          contentType: 'image/webp',
          cacheControl: '3600',
        });

      if (uploadError) {
        logger.error({ uploadError }, 'Product image upload failed');
        throw new AppError('Failed to upload image', 500);
      }

      // Upload thumbnail image
      const { error: thumbUploadError } = await this.supabase.storage
        .from(appConfig.storage.bucket)
        .upload(thumbFileName, thumbBuffer, {
          contentType: 'image/webp',
          cacheControl: '3600',
        });

      if (thumbUploadError) {
        logger.error({ thumbUploadError }, 'Product thumbnail upload failed');
        // Rollback main image upload to keep storage clean
        await this.supabase.storage
          .from(appConfig.storage.bucket)
          .remove([fileName]);
        throw new AppError('Failed to upload image thumbnail', 500);
      }

      const storageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${appConfig.storage.bucket}/${fileName}`;
      const cdnUrl = appConfig.cdn.baseUrl
        ? `${appConfig.cdn.baseUrl}/${appConfig.storage.bucket}/${fileName}`
        : storageUrl;

      const thumbStorageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${appConfig.storage.bucket}/${thumbFileName}`;
      const thumbCdnUrl = appConfig.cdn.baseUrl
        ? `${appConfig.cdn.baseUrl}/${appConfig.storage.bucket}/${thumbFileName}`
        : thumbStorageUrl;

      const isPrimary = displayOrder === 0;

      const imageRecord = await this.repo.addProductImage(productId, {
        storage_url: storageUrl,
        cdn_url: cdnUrl,
        thumbnail_storage_url: thumbStorageUrl,
        thumbnail_cdn_url: thumbCdnUrl,
        display_order: displayOrder,
        is_primary: isPrimary,
      });

      uploadedImages.push(imageRecord);
      displayOrder++;
    }

    // Invalidate product cache
    await this.redis.del(CACHE_KEYS.PRODUCT(productId));

    return uploadedImages;
  }

  // ─────────────────────────────────────────
  // DELETE PRODUCT IMAGE
  // ─────────────────────────────────────────
  async deleteProductImage(sellerId, productId, imageId) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new NotFoundError('Product');

    if (product.users?.id !== sellerId) {
      throw new ForbiddenError('You do not own this product');
    }

    const image = await this.repo.findProductImage(imageId, productId);
    if (!image) throw new NotFoundError('Image');

    // Delete from Supabase Storage
    const filePath = image.storage_url.split(
      `/storage/v1/object/public/${appConfig.storage.bucket}/`
    )[1];

    const thumbFilePath = image.thumbnail_storage_url
      ? image.thumbnail_storage_url.split(
          `/storage/v1/object/public/${appConfig.storage.bucket}/`
        )[1]
      : null;

    const filesToRemove = [filePath, thumbFilePath].filter(Boolean);

    if (filesToRemove.length > 0) {
      const { error: storageError } = await this.supabase.storage
        .from(appConfig.storage.bucket)
        .remove(filesToRemove);

      if (storageError) {
        logger.warn({ storageError }, 'Storage deletion failed — removing DB record anyway');
      }
    }

    await this.repo.deleteProductImage(imageId);

    // If deleted image was primary, set next image as primary
    if (image.is_primary) {
      const { data: nextImage } = await this.supabase
        .from('product_images')
        .select('id')
        .eq('product_id', productId)
        .order('display_order', { ascending: true })
        .limit(1)
        .single();

      if (nextImage) {
        await this.supabase
          .from('product_images')
          .update({ is_primary: true })
          .eq('id', nextImage.id);
      }
    }

    await this.redis.del(CACHE_KEYS.PRODUCT(productId));

    return { message: 'Image deleted successfully' };
  }

  // ─────────────────────────────────────────
  // UPLOAD PRODUCT VIDEO
  // ─────────────────────────────────────────
  async uploadProductVideo(sellerId, productId, fileBuffer, mimetype) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new NotFoundError('Product');

    if (product.users?.id !== sellerId) {
      throw new ForbiddenError('You do not own this product');
    }

    if (!constants.ALLOWED_VIDEO_TYPES.includes(mimetype)) {
      throw new AppError('Invalid video type. MP4 and MOV only.', 400);
    }

    if (
      fileBuffer.length >
      constants.MAX_VIDEO_SIZE_MB * 1024 * 1024
    ) {
      throw new AppError(
        `Video too large. Maximum ${constants.MAX_VIDEO_SIZE_MB}MB.`,
        400
      );
    }

    const fileName = `products/${productId}/video/${uuidv4()}.mp4`;

    const { error: uploadError } = await this.supabase.storage
      .from(appConfig.storage.bucket)
      .upload(fileName, fileBuffer, {
        contentType: mimetype,
        cacheControl: '3600',
      });

    if (uploadError) {
      logger.error({ uploadError }, 'Product video upload failed');
      throw new AppError('Failed to upload video', 500);
    }

    const storageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${appConfig.storage.bucket}/${fileName}`;
    const cdnUrl = appConfig.cdn.baseUrl
      ? `${appConfig.cdn.baseUrl}/${appConfig.storage.bucket}/${fileName}`
      : storageUrl;

    const video = await this.repo.addProductVideo(productId, {
      storage_url: storageUrl,
      cdn_url: cdnUrl,
    });

    await this.redis.del(CACHE_KEYS.PRODUCT(productId));

    return video;
  }

  // ─────────────────────────────────────────
  // BROWSE ALL PRODUCTS
  // ─────────────────────────────────────────
  async browseProducts(query) {
    const { page, limit, offset } = getPaginationParams(query);

    const parsedMinPrice = query.min_price ? parseFloat(query.min_price) : undefined;
    const parsedMaxPrice = query.max_price ? parseFloat(query.max_price) : undefined;
    const parsedRadiusKm = query.radius_km ? parseFloat(query.radius_km) : undefined;
    const parsedLat = query.lat ? parseFloat(query.lat) : undefined;
    const parsedLng = query.lng ? parseFloat(query.lng) : undefined;

    const minPrice = isNaN(parsedMinPrice) || parsedMinPrice < 0 ? undefined : parsedMinPrice;
    const maxPrice = isNaN(parsedMaxPrice) || parsedMaxPrice < 0 ? undefined : parsedMaxPrice;
    const radiusKm = isNaN(parsedRadiusKm) || parsedRadiusKm < 0 ? undefined : parsedRadiusKm;
    const lat = isNaN(parsedLat) ? undefined : parsedLat;
    const lng = isNaN(parsedLng) ? undefined : parsedLng;

    const { data, count } = await this.repo.browseProducts({
      limit,
      offset,
      categoryId: query.category_id,
      minPrice,
      maxPrice,
      condition:  query.condition,
      sort:       query.sort || 'newest',
      city:       query.city,
      lat,
      lng,
      radiusKm,
    });

  return { data, pagination: { page, limit, total: count } };
}

  // ─────────────────────────────────────────
  // FEED: TRENDING
  // ─────────────────────────────────────────
  async getTrendingFeed() {
    const cached = await this.redis.get(CACHE_KEYS.TRENDING_FEED);
    if (cached) return cached;

    const data = await this.repo.getTrendingProducts(20);
    await this.redis.set(CACHE_KEYS.TRENDING_FEED, data, CACHE_TTL.TRENDING_FEED);

    return data;
  }

  // ─────────────────────────────────────────
  // FEED: RECENT
  // ─────────────────────────────────────────
  async getRecentFeed(query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getRecentProducts(limit, offset);
    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // FEED: NEARBY
  // ─────────────────────────────────────────
  async getNearbyFeed(lat, lng, radiusKm = 50) {
    if (!lat || !lng) {
      throw new AppError(
        'Location coordinates are required for nearby products',
        400,
        'LOCATION_REQUIRED'
      );
    }

    // Geohash-based cache key (approximate location)
    const geohash = `${Math.round(lat * 10) / 10}_${Math.round(lng * 10) / 10}`;
    const cacheKey = CACHE_KEYS.NEARBY_FEED(geohash);

    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const data = await this.repo.getNearbyProducts(lat, lng, radiusKm, 20);
    await this.redis.set(cacheKey, data, CACHE_TTL.NEARBY_FEED);

    return data;
  }

  // ─────────────────────────────────────────
  // FEED: RECOMMENDED
  // ─────────────────────────────────────────
  async getRecommendedFeed(userId) {
    const cacheKey = CACHE_KEYS.RECOMMENDED_FEED(userId);

    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const data = await this.repo.getRecommendedProducts(userId, 20);
    await this.redis.set(cacheKey, data, CACHE_TTL.RECOMMENDED_FEED);

    return data;
  }

  // ─────────────────────────────────────────
  // FAVORITE PRODUCT
  // ─────────────────────────────────────────
  async favoriteProduct(userId, productId) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new NotFoundError('Product');

    if (product.status !== PRODUCT_STATUS.AVAILABLE) {
      throw new AppError('Cannot favorite a product that is not available', 400);
    }

    const alreadyFavorited = await this.repo.isProductFavorited(userId, productId);
    if (alreadyFavorited) {
      throw new AppError('Product already in favorites', 409, 'ALREADY_FAVORITED');
    }

    await this.repo.addFavorite(userId, productId);
    await this.redis.del(CACHE_KEYS.PRODUCT(productId));

    return { message: 'Added to favorites' };
  }

  // ─────────────────────────────────────────
  // UNFAVORITE PRODUCT
  // ─────────────────────────────────────────
  async unfavoriteProduct(userId, productId) {
    await this.repo.removeFavorite(userId, productId);
    await this.redis.del(CACHE_KEYS.PRODUCT(productId));
    return { message: 'Removed from favorites' };
  }

  // ─────────────────────────────────────────
  // PRIVATE: Record view with Redis dedup
  // Prevents single user/IP inflating view count
  // ─────────────────────────────────────────
  async _recordViewWithDedup(productId, viewerId, ipAddress) {
    const dedupKey = viewerId
      ? `view_dedup:product:${productId}:user:${viewerId}`
      : `view_dedup:product:${productId}:ip:${ipAddress}`;

    // Try to set the key — only succeeds if not already set (NX flag)
    const isNewView = await this.redis.setnx(dedupKey, true, 3600); // 1hr TTL

    if (isNewView) {
      await this.repo.recordView(
        productId,
        viewerId || null,
        ipAddress,
        null
      );
    }
  }

  // ─────────────────────────────────────────
  // PRIVATE: Notify favoriters of price change
  // ─────────────────────────────────────────
  async _notifyPriceChange(product, oldPrice, newPrice) {
    const favoriters = await this.repo.getProductFavoriters(product.id);

    for (const user of favoriters) {
      await this.notificationService.createNotification({
        userId: user.id,
        type: constants.NOTIFICATION_TYPES.PRICE_UPDATE,
        title: 'Price Drop! 📉',
        body: `${product.title} dropped from ${product.currency} ${oldPrice} to ${product.currency} ${newPrice}`,
        data: {
          productId: product.id,
          productSlug: product.slug,
          oldPrice,
          newPrice,
        },
      });
    }
  }
}

module.exports = ProductService;