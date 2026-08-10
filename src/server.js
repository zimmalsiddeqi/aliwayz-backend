'use strict';

require('dotenv').config();

const buildApp = require('./app');
const appConfig = require('./config/app.config');
const logger = require('./shared/utils/logger');
const { startScheduler } = require('./jobs/scheduler');

const start = async () => {
  let fastify;

  try {
    fastify = await buildApp();

    await fastify.listen({
      port: appConfig.port,
      host: '0.0.0.0',
    });

    logger.info(`🚀 ${appConfig.appName} running on port ${appConfig.port}`);
    logger.info(`📡 Environment: ${appConfig.env}`);
    logger.info(
      `🔗 API: http://localhost:${appConfig.port}/api/${appConfig.apiVersion}`
    );

    await startScheduler(fastify);
    logger.info('⚙️  Background jobs scheduler started');

  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  // ─────────────────────────────────────────
  // Graceful Shutdown — close Fastify properly
  // ─────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);
    try {
      await fastify.close();
      logger.info('Server closed gracefully');
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled Promise Rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught Exception');
    process.exit(1);
  });
};

start();