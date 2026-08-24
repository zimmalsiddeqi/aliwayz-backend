'use strict';

const fp = require('fastify-plugin');
const Redis = require('ioredis');
const redisConfig = require('../config/redis.config');
const logger = require('../shared/utils/logger');

async function redisPlugin(fastify) {
  const redis = new Redis({
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password || undefined,
    db: redisConfig.db,
    keyPrefix: redisConfig.keyPrefix,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    connectTimeout: 5000, // shorter timeout for faster fallback
    retryStrategy: (times) => {
      if (times > 3) {
        return null; // Stop retrying after 3 attempts
      }
      return Math.min(times * 200, 2000);
    },
  });

  let useFallback = true; // Default to fallback until connected

  redis.on('error', (err) => {
    if (!useFallback) {
      logger.warn(
        { err: err.message },
        '⚠️ Redis connection/runtime error. Falling back to IN-MEMORY cache.'
      );
      useFallback = true;
    }
  });

  redis.on('ready', () => {
    logger.info('✅ Redis connected successfully and ready');
    useFallback = false;
  });

  redis.on('reconnecting', () => {
    logger.warn('Redis reconnecting...');
  });

  // ─────────────────────────────────────────
  // In-Memory Fallback Cache Implementation
  // ─────────────────────────────────────────
  const memoryCache = new Map();
  const fallbackCache = {
    async get(key) {
      const entry = memoryCache.get(key);
      if (!entry) return null;
      if (entry.expiry && entry.expiry < Date.now()) {
        memoryCache.delete(key);
        return null;
      }
      return entry.value;
    },

    async set(key, value, ttlSeconds = null) {
      const expiry = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
      memoryCache.set(key, { value, expiry });
    },

    async del(...keys) {
      keys.forEach((k) => memoryCache.delete(k));
    },

    async getdel(key) {
      const val = await this.get(key);
      memoryCache.delete(key);
      return val;
    },

    async exists(key) {
      const val = await this.get(key);
      return val !== null;
    },

    async incr(key, ttlSeconds = null) {
      const val = (await this.get(key)) || 0;
      const newVal = val + 1;
      await this.set(key, newVal, ttlSeconds);
      return newVal;
    },

    async setnx(key, value, ttlSeconds) {
      const exists = await this.exists(key);
      if (exists) return false;
      await this.set(key, value, ttlSeconds);
      return true;
    },

    client: null,
  };

  // ─────────────────────────────────────────
  // Cache wrapper with JSON serialization
  // ─────────────────────────────────────────
  const cache = {
    async get(key) {
      try {
        const value = await redis.get(key);
        if (!value) return null;
        return JSON.parse(value);
      } catch (err) {
        logger.error({ err, key }, 'Redis GET error');
        return null;
      }
    },

    async set(key, value, ttlSeconds = null) {
      try {
        const serialized = JSON.stringify(value);
        if (ttlSeconds) {
          await redis.setex(key, ttlSeconds, serialized);
        } else {
          await redis.set(key, serialized);
        }
      } catch (err) {
        logger.error({ err, key }, 'Redis SET error');
      }
    },

    async del(...keys) {
      try {
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch (err) {
        logger.error({ err, keys }, 'Redis DEL error');
      }
    },

    async getdel(key) {
      try {
        const value = await redis.getdel(key);
        if (!value) return null;
        return JSON.parse(value);
      } catch (err) {
        logger.error({ err, key }, 'Redis GETDEL error');
        return null;
      }
    },

    async exists(key) {
      try {
        const result = await redis.exists(key);
        return result === 1;
      } catch (err) {
        logger.error({ err, key }, 'Redis EXISTS error');
        return false;
      }
    },

    async incr(key, ttlSeconds = null) {
      try {
        const value = await redis.incr(key);
        if (ttlSeconds && value === 1) {
          await redis.expire(key, ttlSeconds);
        }
        return value;
      } catch (err) {
        logger.error({ err, key }, 'Redis INCR error');
        return 0;
      }
    },

    async setnx(key, value, ttlSeconds) {
      try {
        const result = await redis.set(
          key,
          JSON.stringify(value),
          'EX',
          ttlSeconds,
          'NX'
        );
        return result === 'OK';
      } catch (err) {
        logger.error({ err, key }, 'Redis SETNX error');
        return false;
      }
    },

    client: redis,
  };

  // ─────────────────────────────────────────
  // Dynamic Cache Router (checks useFallback)
  // ─────────────────────────────────────────
  const dynamicCache = {
    get: (key) => (useFallback ? fallbackCache.get(key) : cache.get(key)),
    set: (key, value, ttl) =>
      useFallback ? fallbackCache.set(key, value, ttl) : cache.set(key, value, ttl),
    del: (...keys) =>
      useFallback ? fallbackCache.del(...keys) : cache.del(...keys),
    getdel: (key) => (useFallback ? fallbackCache.getdel(key) : cache.getdel(key)),
    exists: (key) => (useFallback ? fallbackCache.exists(key) : cache.exists(key)),
    incr: (key, ttl) =>
      useFallback ? fallbackCache.incr(key, ttl) : cache.incr(key, ttl),
    setnx: (key, value, ttl) =>
      useFallback ? fallbackCache.setnx(key, value, ttl) : cache.setnx(key, value, ttl),
    client: redis,
  };

  fastify.decorate('redis', dynamicCache);
  fastify.decorate('redisClient', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
    logger.info('Redis connection closed');
  });
}

module.exports = fp(redisPlugin, {
  name: 'redis-plugin',
});