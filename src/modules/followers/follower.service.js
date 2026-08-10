'use strict';

const FollowerRepository = require('./follower.repository');
const NotificationService = require('../notifications/notification.service');

const { getPaginationParams } = require('../../shared/utils/paginate');
const { CACHE_KEYS } = require('../../shared/constants/cacheKeys');
const constants = require('../../config/constants');
const logger = require('../../shared/utils/logger');

const AppError = require('../../shared/errors/AppError');
const NotFoundError = require('../../shared/errors/NotFoundError');

class FollowerService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new FollowerRepository(supabase);
    this.notificationService = new NotificationService(supabase, redis);
  }

  // ─────────────────────────────────────────
  // FOLLOW STORE
  // ─────────────────────────────────────────
  async followStore(followerId, storeId) {
    const store = await this.repo.getStoreOwnerId(storeId);
    if (!store) throw new NotFoundError('Store');

    if (store.user_id === followerId) {
      throw new AppError(
        'You cannot follow your own store',
        400,
        'CANNOT_FOLLOW_OWN'
      );
    }

    const alreadyFollowing = await this.repo.isFollowing(followerId, storeId);
    if (alreadyFollowing) {
      throw new AppError(
        'You are already following this store',
        409,
        'ALREADY_FOLLOWING'
      );
    }

    await this.repo.followStore(followerId, storeId);

    // Invalidate store cache
    await this.redis.del(CACHE_KEYS.STORE(store.slug));

    // ✅ FIX: Call RPC directly — do NOT nest inside update()
    await this.supabase.rpc('increment_seller_followers', {
      p_seller_id: store.user_id,
    });

    // Notify store owner
    await this.notificationService.createNotification({
      userId: store.user_id,
      type: constants.NOTIFICATION_TYPES.NEW_FOLLOWER,
      title: 'New Follower! 🎉',
      body: `Someone started following your store ${store.store_name}`,
      data: {
        storeId,
        storeSlug: store.slug,
      },
    });

    logger.info({ followerId, storeId }, 'Store followed');

    return {
      message: 'Store followed successfully',
      store_id: storeId,
      is_following: true,
    };
  }

  // ─────────────────────────────────────────
  // UNFOLLOW STORE
  // ─────────────────────────────────────────
  async unfollowStore(followerId, storeId) {
    const store = await this.repo.getStoreOwnerId(storeId);
    if (!store) throw new NotFoundError('Store');

    const isFollowing = await this.repo.isFollowing(followerId, storeId);
    if (!isFollowing) {
      throw new AppError(
        'You are not following this store',
        400,
        'NOT_FOLLOWING'
      );
    }

    await this.repo.unfollowStore(followerId, storeId);

    // ✅ FIX: Call RPC directly
    await this.supabase.rpc('decrement_seller_followers', {
      p_seller_id: store.user_id,
    });

    await this.redis.del(CACHE_KEYS.STORE(store.slug));

    logger.info({ followerId, storeId }, 'Store unfollowed');

    return {
      message: 'Store unfollowed successfully',
      store_id: storeId,
      is_following: false,
    };
  }

  // ─────────────────────────────────────────
  // GET STORE FOLLOWERS
  // ─────────────────────────────────────────
  async getStoreFollowers(storeId, query) {
    const { page, limit, offset } = getPaginationParams(query);

    const store = await this.repo.getStoreOwnerId(storeId);
    if (!store) throw new NotFoundError('Store');

    const { data, count } = await this.repo.getStoreFollowers(storeId, {
      limit,
      offset,
    });

    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // GET USER FOLLOWED STORES
  // ─────────────────────────────────────────
  async getUserFollowedStores(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);

    const { data, count } = await this.repo.getUserFollowedStores(userId, {
      limit,
      offset,
    });

    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // CHECK FOLLOW STATUS
  // ─────────────────────────────────────────
  async checkFollowStatus(userId, storeId) {
    const isFollowing = await this.repo.isFollowing(userId, storeId);
    const followerCount = await this.repo.getFollowerCount(storeId);

    return {
      is_following: isFollowing,
      follower_count: followerCount,
    };
  }
}

module.exports = FollowerService;