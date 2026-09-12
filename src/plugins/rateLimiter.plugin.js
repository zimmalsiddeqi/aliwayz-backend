'use strict';

const fp = require('fastify-plugin');
const appConfig = require('../config/app.config');
const logger = require('../shared/utils/logger');

async function rateLimiterPlugin(fastify) {
  const rateLimitOpts = {
    global: true,
    max: appConfig.rateLimit.max,
    timeWindow: appConfig.rateLimit.windowMs,
    keyGenerator: (request) => {
      // Bypass rate limit in tests by generating a unique key per request
      if (process.env.NODE_ENV === 'test') {
        return Math.random().toString();
      }
      // Use authenticated user ID if available, else IP
      return request.user?.id || request.ip;
    },
    errorResponseBuilder: (request, context) => {
      logger.warn(
        { ip: request.ip, url: request.url },
        'Rate limit exceeded'
      );
      return {
        success: false,
        message: 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
    // Stricter limits for auth endpoints
    allowList: [],
  };

  // Only use Redis store if Redis is actively connected and ready
  if (typeof fastify.isRedisConnected === 'function' && fastify.isRedisConnected() && fastify.redisClient?.status === 'ready') {
    rateLimitOpts.redis = fastify.redisClient;
  }

  await fastify.register(require('@fastify/rate-limit'), rateLimitOpts);
}

module.exports = fp(rateLimiterPlugin, {
  name: 'rate-limiter-plugin',
  dependencies: ['redis-plugin'],
});