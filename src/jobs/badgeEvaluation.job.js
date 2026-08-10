'use strict';

const BadgeEngine = require('../modules/badges/badge.engine');
const BadgeRepository = require('../modules/badges/badge.repository');
const logger = require('../shared/utils/logger');

module.exports = async function badgeEvaluationJob(supabase, redis) {
  const badgeRepo = new BadgeRepository(supabase);
  const badgeEngine = new BadgeEngine(supabase, redis);

  // Get all active sellers for evaluation
  const sellerIds = await badgeRepo.getAllActiveSellersForEvaluation();

  logger.info(
    { count: sellerIds.length },
    'badgeEvaluation: Starting batch evaluation'
  );

  let processed = 0;
  let errors = 0;

  // Process in batches of 50 to avoid overloading the DB
  const batchSize = 50;

  for (let i = 0; i < sellerIds.length; i += batchSize) {
    const batch = sellerIds.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (userId) => {
        try {
          await badgeEngine.evaluateAndAssignBadges(
            userId,
            'scheduled_evaluation'
          );
          processed++;
        } catch (err) {
          logger.warn({ err, userId }, 'badgeEvaluation: Failed for user');
          errors++;
        }
      })
    );

    // Small delay between batches to avoid DB overload
    if (i + batchSize < sellerIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  logger.info(
    { processed, errors, total: sellerIds.length },
    'badgeEvaluation: Job complete'
  );
};