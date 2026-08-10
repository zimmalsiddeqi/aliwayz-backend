'use strict';

const logger = require('../shared/utils/logger');

/**
 * Logs every incoming request with method, URL, status, and duration
 */
const requestLogger = {
  onRequest: async (request) => {
    request.startTime = Date.now();
  },

  onResponse: async (request, reply) => {
    const duration = Date.now() - request.startTime;
    logger.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration: `${duration}ms`,
      ip: request.ip,
      userId: request.user?.id || 'guest',
    });
  },

  onError: async (request, reply, error) => {
    const duration = Date.now() - request.startTime;
    logger.error({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration: `${duration}ms`,
      error: error.message,
      ip: request.ip,
      userId: request.user?.id || 'guest',
    });
  },
};

module.exports = requestLogger;