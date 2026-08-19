'use strict';

const logger = require('../shared/utils/logger');
const { CACHE_KEYS } = require('../shared/constants/cacheKeys');
module.exports = async function cleanupSoldProductsJob(supabase, redis) {
  const now = new Date().toISOString();

  // Find all sold products whose 24hr window has passed (just get IDs to minimize payload)
  const { data: productsToRemove, error: fetchError } = await supabase
    .from('products')
    .select('id, title')
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
    'cleanupSoldProducts: Running batch cleanup of sold products'
  );

  // Call the database batch RPC
  const { data: count, error: rpcError } = await supabase.rpc('auto_remove_sold_products');

  if (rpcError) {
    logger.error({ rpcError }, 'cleanupSoldProducts: auto_remove_sold_products RPC failed');
    return;
  }

  // Invalidate product caches in parallel
  const cachePromises = productsToRemove.map((product) =>
    redis.del(CACHE_KEYS.PRODUCT(product.id))
  );
  
  // Invalidate feed caches
  cachePromises.push(redis.del(CACHE_KEYS.TRENDING_FEED));
  cachePromises.push(redis.del(CACHE_KEYS.RECENT_FEED));

  await Promise.all(cachePromises);

  logger.info(
    { removed: count },
    'cleanupSoldProducts: Job complete'
  );
};