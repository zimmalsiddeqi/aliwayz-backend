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
    connectTimeout: 10000,
    lazyConnect: true, // Don't auto-connect — we control it
    retryStrategy: (times) => {
      if (times > 3) {
        return null; // Stop retrying after 3 attempts on startup
      }
      return Math.min(times * 200, 2000);
    },
  });

  // ─────────────────────────────────────────
  // Attempt connection with clear error message
  // ─────────────────────────────────────────
  try {
    await redis.connect();
    const pong = await redis.ping();

    if (pong !== 'PONG') {
      throw new Error('Redis ping returned unexpected response');
    }

    logger.info('✅ Redis connected successfully');
  } catch (err) {
    logger.error(
      { err: err.message },
      '❌ Redis connection FAILED. Is Redis running?\n' +
      '   → Run: docker run -d --name marketplace-redis -p 6379:6379 redis:7-alpine\n' +
      '   → Or:  docker-compose up -d redis'
    );
    throw new Error(
      'Redis connection failed — start Redis before running the server'
    );
  }

  redis.on('error', (err) => {
    logger.error({ err: err.message }, 'Redis runtime error');
  });

  redis.on('reconnecting', () => {
    logger.warn('Redis reconnecting...');
  });

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

  fastify.decorate('redis', cache);
  fastify.decorate('redisClient', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
    logger.info('Redis connection closed');
  });
}

module.exports = fp(redisPlugin, {
  name: 'redis-plugin',
});