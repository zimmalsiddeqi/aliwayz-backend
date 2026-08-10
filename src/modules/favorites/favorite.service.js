'use strict';

const FavoriteRepository = require('./favorite.repository');
const NotificationService = require('../notifications/notification.service');

const { getPaginationParams } = require('../../shared/utils/paginate');
const { CACHE_KEYS } = require('../../shared/constants/cacheKeys');
const { PRODUCT_STATUS } = require('../../shared/constants/productStatus');
const constants = require('../../config/constants');
const logger = require('../../shared/utils/logger');

const AppError = require('../../shared/errors/AppError');
const NotFoundError = require('../../shared/errors/NotFoundError');

class FavoriteService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new FavoriteRepository(supabase);
    this.notificationService = new NotificationService(supabase, redis);
  }

  // ─────────────────────────────────────────
  // ADD FAVORITE
  // ─────────────────────────────────────────
  async addFavorite(userId, productId) {
    const product = await this.repo.getProductBasic(productId);

    if (!product || product.is_deleted) {
      throw new NotFoundError('Product');
    }

    // Cannot favorite own product
    if (product.seller_id === userId) {
      throw new AppError(
        'You cannot favorite your own product',
        400,
        'CANNOT_FAVORITE_OWN'
      );
    }

    if (product.status === PRODUCT_STATUS.SOLD) {
      throw new AppError(
        'Cannot favorite a sold product',
        400,
        'PRODUCT_SOLD'
      );
    }

    const alreadyFavorited = await this.repo.isFavorited(userId, productId);
    if (alreadyFavorited) {
      throw new AppError(
        'Product already in your favorites',
        409,
        'ALREADY_FAVORITED'
      );
    }

    await this.repo.addFavorite(userId, productId);

    // Invalidate product cache (favorite_count changed)
    await this.redis.del(CACHE_KEYS.PRODUCT(productId));

    logger.info({ userId, productId }, 'Product favorited');

    return {
      message: 'Added to favorites',
      product_id: productId,
      is_favorited: true,
    };
  }

  // ─────────────────────────────────────────
  // REMOVE FAVORITE
  // ─────────────────────────────────────────
  async removeFavorite(userId, productId) {
    const isFavorited = await this.repo.isFavorited(userId, productId);

    if (!isFavorited) {
      throw new AppError(
        'Product is not in your favorites',
        400,
        'NOT_FAVORITED'
      );
    }

    await this.repo.removeFavorite(userId, productId);

    // Invalidate product cache
    await this.redis.del(CACHE_KEYS.PRODUCT(productId));

    logger.info({ userId, productId }, 'Product unfavorited');

    return {
      message: 'Removed from favorites',
      product_id: productId,
      is_favorited: false,
    };
  }

  // ─────────────────────────────────────────
  // GET USER FAVORITES
  // ─────────────────────────────────────────
  async getUserFavorites(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);

    const { data, count } = await this.repo.getUserFavorites(userId, {
      limit,
      offset,
    });

    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // CHECK FAVORITE STATUS
  // ─────────────────────────────────────────
  async checkFavoriteStatus(userId, productId) {
    const isFavorited = await this.repo.isFavorited(userId, productId);
    const favoriteCount = await this.repo.getFavoriteCount(productId);

    return {
      is_favorited: isFavorited,
      favorite_count: favoriteCount,
    };
  }

  // ─────────────────────────────────────────
  // NOTIFY FAVORITERS OF PRICE CHANGE
  // Called from product service when price drops
  // ─────────────────────────────────────────
  async notifyPriceChange(productId, productTitle, oldPrice, newPrice, currency) {
    const favoriters = await this.repo.getProductFavoriters(productId);

    if (!favoriters || favoriters.length === 0) return;

    logger.info(
      { productId, favoritersCount: favoriters.length },
      'Notifying favoriters of price change'
    );

    for (const user of favoriters) {
      await this.notificationService.createNotification({
        userId: user.id,
        type: constants.NOTIFICATION_TYPES.PRICE_UPDATE,
        title: '📉 Price Drop Alert!',
        body: `${productTitle} dropped from ${currency} ${oldPrice} to ${currency} ${newPrice}`,
        data: {
          productId,
          oldPrice: String(oldPrice),
          newPrice: String(newPrice),
          currency,
        },
      });
    }
  }
}

module.exports = FavoriteService;