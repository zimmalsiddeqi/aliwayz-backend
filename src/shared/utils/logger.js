'use strict';

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  // Production: structured JSON logs (shipped to log aggregator)
  base: {
    env: process.env.NODE_ENV,
    app: process.env.APP_NAME || 'marketplace-api',
  },
  redact: {
    // Never log sensitive fields
    paths: ['password', 'token', 'authorization', 'cookie', 'secret'],
    censor: '[REDACTED]',
  },
});

module.exports = logger;