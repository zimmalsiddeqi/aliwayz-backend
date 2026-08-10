'use strict';

const logger = require('../shared/utils/logger');

module.exports = async function expireQRTokensJob(supabase, redis) {
  const now = new Date().toISOString();

  // Find pending QR transactions that have expired
  const { data: expiredQRs, error } = await supabase
    .from('qr_transactions')
    .select('id, product_id, token_hash')
    .eq('status', 'pending')
    .lte('expires_at', now);

  if (error) {
    logger.error({ error }, 'expireQRTokens: fetch failed');
    return;
  }

  if (!expiredQRs || expiredQRs.length === 0) {
    logger.info('expireQRTokens: No expired QR tokens found');
    return;
  }

  logger.info(
    { count: expiredQRs.length },
    'expireQRTokens: Marking expired QR tokens'
  );

  // Batch update expired QRs in DB
  const expiredIds = expiredQRs.map((q) => q.id);

  const { error: updateError } = await supabase
    .from('qr_transactions')
    .update({ status: 'expired' })
    .in('id', expiredIds);

  if (updateError) {
    logger.error({ updateError }, 'expireQRTokens: batch update failed');
    return;
  }

  // Revert reserved products back to available if QR expired
  const productIds = [...new Set(expiredQRs.map((q) => q.product_id))];

  for (const productId of productIds) {
    const { data: product } = await supabase
      .from('products')
      .select('id, status')
      .eq('id', productId)
      .single();

    if (product && product.status === 'reserved') {
      await supabase
        .from('products')
        .update({
          status: 'available',
          updated_at: new Date().toISOString(),
        })
        .eq('id', productId);

      logger.info(
        { productId },
        'expireQRTokens: Product reverted to available after QR expiry'
      );
    }
  }

  logger.info(
    { expired: expiredIds.length },
    'expireQRTokens: Job complete'
  );
};