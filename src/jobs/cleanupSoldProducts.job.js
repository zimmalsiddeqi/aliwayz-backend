'use strict';

const logger = require('../shared/utils/logger');
const { CACHE_KEYS } = require('../shared/constants/cacheKeys');

module.exports = async function cleanupSoldProductsJob(supabase, redis) {
  const now = new Date().toISOString();

  // Find all sold products whose 24hr window has passed
  const { data: productsToRemove, error: fetchError } = await supabase
    .from('products')
    .select('id, title, slug, seller_id')
    .eq('status', 'sold')
    .eq('is_deleted', false)
    .lte('auto_remove_at', now);

  if (fetchError) {
    logger.error({ fetchError }, 'cleanupSoldProducts: fetch failed');
    return;
  }

  if (!productsToRemove || productsToRemove.length === 0) {
    logger.info('cleanupSoldProducts: No products to clean up');
    return;
  }

  logger.info(
    { count: productsToRemove.length },
    'cleanupSoldProducts: Removing sold products from marketplace'
  );

  for (const product of productsToRemove) {
    try {
      // Soft delete the product (remove from marketplace view)
      const { error: updateError } = await supabase
        .from('products')
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', product.id)
        .eq('status', 'sold');

      if (updateError) {
        logger.error(
          { updateError, productId: product.id },
          'cleanupSoldProducts: Failed to mark product as deleted'
        );
        continue;
      }

      // Invalidate product cache
      await redis.del(CACHE_KEYS.PRODUCT(product.id));

      logger.info(
        { productId: product.id, title: product.title },
        'cleanupSoldProducts: Product removed from marketplace'
      );
    } catch (err) {
      logger.error(
        { err, productId: product.id },
        'cleanupSoldProducts: Unexpected error for product'
      );
    }
  }

  // Invalidate feed caches
  await redis.del(CACHE_KEYS.TRENDING_FEED);
  await redis.del(CACHE_KEYS.RECENT_FEED);

  logger.info(
    { removed: productsToRemove.length },
    'cleanupSoldProducts: Job complete'
  );
};