'use strict';

const cron = require('node-cron');
const logger = require('../shared/utils/logger');

const cleanupSoldProductsJob = require('./cleanupSoldProducts.job');
const expireQRTokensJob = require('./expireQRTokens.job');
const updateTrendingFeedJob = require('./updateTrendingFeed.job');
const badgeEvaluationJob = require('./badgeEvaluation.job');

async function startScheduler(fastify) {
  const { supabase, redis } = fastify;

  // ─────────────────────────────────────────
  // JOB 1: Cleanup sold products after 24hrs
  // Runs every hour
  // ─────────────────────────────────────────
  cron.schedule('0 * * * *', async () => {
    logger.info('Running: cleanupSoldProducts job');
    try {
      await cleanupSoldProductsJob(supabase, redis);
    } catch (err) {
      logger.error({ err }, 'cleanupSoldProducts job failed');
    }
  });

  // ─────────────────────────────────────────
  // JOB 2: Expire old pending QR tokens in DB
  // Runs every 5 minutes
  // ─────────────────────────────────────────
  cron.schedule('*/5 * * * *', async () => {
    logger.info('Running: expireQRTokens job');
    try {
      await expireQRTokensJob(supabase, redis);
    } catch (err) {
      logger.error({ err }, 'expireQRTokens job failed');
    }
  });

  // ─────────────────────────────────────────
  // JOB 3: Refresh trending feed cache
  // Runs every 5 minutes
  // ─────────────────────────────────────────
  cron.schedule('*/5 * * * *', async () => {
    logger.info('Running: updateTrendingFeed job');
    try {
      await updateTrendingFeedJob(supabase, redis);
    } catch (err) {
      logger.error({ err }, 'updateTrendingFeed job failed');
    }
  });

  // ─────────────────────────────────────────
  // JOB 4: Periodic badge re-evaluation
  // Runs every day at 2am (low traffic window)
  // ─────────────────────────────────────────
  cron.schedule('0 2 * * *', async () => {
    logger.info('Running: badgeEvaluation job');
    try {
      await badgeEvaluationJob(supabase, redis);
    } catch (err) {
      logger.error({ err }, 'badgeEvaluation job failed');
    }
  });

  logger.info('All background job schedulers registered');
}

module.exports = { startScheduler };