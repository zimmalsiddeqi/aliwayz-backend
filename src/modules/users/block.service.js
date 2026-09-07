'use strict';

const BlockRepository = require('./block.repository');
const AppError = require('../../shared/errors/AppError');
const logger = require('../../shared/utils/logger');

class BlockService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new BlockRepository(supabase);
  }

  async blockUser(blockerId, blockedId) {
    if (blockerId === blockedId) {
      throw new AppError('You cannot block yourself', 400, 'CANNOT_BLOCK_SELF');
    }

    const result = await this.repo.blockUser(blockerId, blockedId);

    // Invalidate blocked user cache in Redis
    if (this.redis) {
      await this.redis.del(`user:blocks:${blockerId}`);
      await this.redis.del(`user:blocks:${blockedId}`);
    }

    logger.info({ blockerId, blockedId }, 'User blocked');
    return result;
  }

  async unblockUser(blockerId, blockedId) {
    const result = await this.repo.unblockUser(blockerId, blockedId);

    if (this.redis) {
      await this.redis.del(`user:blocks:${blockerId}`);
      await this.redis.del(`user:blocks:${blockedId}`);
    }

    logger.info({ blockerId, blockedId }, 'User unblocked');
    return result;
  }

  async getBlockedUsers(blockerId) {
    return this.repo.getBlockedUsers(blockerId);
  }

  async getBlockedUserIds(userId) {
    if (!userId) return [];
    const cacheKey = `user:blocks:${userId}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (err) {
        logger.warn({ err }, 'Redis block lookup error');
      }
    }

    const ids = await this.repo.getBlockedUserIds(userId);

    if (this.redis && ids.length > 0) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(ids), 300); // 5 min TTL
      } catch (err) {
        logger.warn({ err }, 'Redis block cache save error');
      }
    }

    return ids;
  }
}

module.exports = BlockService;
