'use strict';

require('dotenv').config();

const redisConfig = Object.freeze({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB, 10) || 0,
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'marketplace:',
  // Retry strategy for production resilience
  retryStrategy: (times) => {
    if (times > 10) {
      return new Error('Redis: Max retry attempts reached');
    }
    return Math.min(times * 100, 3000); // Exponential backoff, max 3s
  },
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  connectTimeout: 10000,
  lazyConnect: false,
});

module.exports = redisConfig;