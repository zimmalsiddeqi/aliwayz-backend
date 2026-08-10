'use strict';

const logger = require('../shared/utils/logger');
const { CACHE_KEYS, CACHE_TTL } = require('../shared/constants/cacheKeys');

module.exports = async function updateTrendingFeedJob(supabase, redis) {
  const twoDaysAgo = new Date(
    Date.now() - 48 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from('products')
    .select(`
      id,
      title,
      slug,
      price,
      currency,
      condition,
      location_city,
      view_count,
      favorite_count,
      created_at,
      product_images (
        cdn_url,
        storage_url,
        is_primary
      ),
      stores (
        id,
        store_name,
        slug,
        logo_url,
        is_verified
      )
    `)
    .eq('status', 'available')
    .eq('is_deleted', false)
    .gte('updated_at', twoDaysAgo)
    .order('view_count', { ascending: false })
    .order('favorite_count', { ascending: false })
    .limit(20);

  if (error) {
    logger.error({ error }, 'updateTrendingFeed: fetch failed');
    return;
  }

  await redis.set(CACHE_KEYS.TRENDING_FEED, data || [], CACHE_TTL.TRENDING_FEED);

  logger.info(
    { count: data?.length || 0 },
    'updateTrendingFeed: Cache refreshed'
  );
};