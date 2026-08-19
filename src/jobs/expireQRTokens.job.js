'use strict';

const logger = require('../shared/utils/logger');

module.exports = async function expireQRTokensJob(supabase, redis) {
  try {
    const { data: count, error } = await supabase.rpc('expire_stale_qr_tokens');

    if (error) {
      logger.error({ error }, 'expireQRTokens: batch execution failed');
      return;
    }

    if (count > 0) {
      logger.info(
        { revertedCount: count },
        'expireQRTokens: Reverted products linked to expired QRs'
      );
    } else {
      logger.info('expireQRTokens: No expired QR tokens to process');
    }
  } catch (err) {
    logger.error({ err }, 'expireQRTokens: Job failed');
  }
};