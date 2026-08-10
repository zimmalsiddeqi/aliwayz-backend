'use strict';

const logger = require('../../shared/utils/logger');
const { getPaginationParams } = require('../../shared/utils/paginate');
const { sanitizeString } = require('../../middleware/sanitize');
const AppError = require('../../shared/errors/AppError');
const constants = require('../../config/constants');

// Popular searches Redis key
const POPULAR_SEARCHES_KEY = 'search:popular:zset';
const SEARCH_CACHE_TTL = 60; // 1 minute for search results

class SearchService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
  }

  // ─────────────────────────────────────────
  // FULL PRODUCT SEARCH
  // Uses PostgreSQL full-text search on search_vector
  // ─────────────────────────────────────────
  async searchProducts(query, userId = null) {
    const { page, limit, offset } = getPaginationParams(query);

    // Sanitize query to prevent injection
    const searchQuery = sanitizeString(query.q);

    if (!searchQuery || searchQuery.length < 1) {
      throw new AppError('Search query is required', 400, 'EMPTY_QUERY');
    }

    // Build cache key from all filter params
    const cacheKey = `search:products:${Buffer.from(JSON.stringify(query)).toString('base64')}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      // Still track search history even for cached results
      if (userId) {
        this._trackSearchHistory(userId, searchQuery, cached.pagination?.total || 0)
          .catch(() => {});
      }
      this._incrementPopularSearch(searchQuery).catch(() => {});
      return cached;
    }

    // Build full-text search query
    // websearch_to_tsquery handles natural language: "phone case" -> 'phone' & 'case'
    let supabaseQuery = this.supabase
      .from('products')
      .select(
        `
        id,
        title,
        slug,
        price,
        currency,
        condition,
        brand,
        status,
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
          is_verified,
          average_rating
        ),
        users:seller_id (
          id,
          username,
          avatar_url
        )
      `,
        { count: 'exact' }
      )
      .eq('status', 'available')
      .eq('is_deleted', false)
      .textSearch('search_vector', searchQuery, {
        type: 'websearch',
        config: 'english',
      });

    // Apply filters
    if (query.category_id) {
      supabaseQuery = supabaseQuery.eq('category_id', query.category_id);
    }

    if (query.min_price !== undefined) {
      supabaseQuery = supabaseQuery.gte('price', parseFloat(query.min_price));
    }

    if (query.max_price !== undefined) {
      supabaseQuery = supabaseQuery.lte('price', parseFloat(query.max_price));
    }

    if (query.condition) {
      supabaseQuery = supabaseQuery.eq('condition', query.condition);
    }

    if (query.city) {
      supabaseQuery = supabaseQuery.ilike('location_city', `%${query.city}%`);
    }

    // Verified seller filter
    if (query.verified_sellers) {
      supabaseQuery = supabaseQuery.eq('stores.is_verified', true);
    }

    // Sorting
    switch (query.sort) {
      case 'newest':
        supabaseQuery = supabaseQuery.order('created_at', { ascending: false });
        break;
      case 'price_asc':
        supabaseQuery = supabaseQuery.order('price', { ascending: true });
        break;
      case 'price_desc':
        supabaseQuery = supabaseQuery.order('price', { ascending: false });
        break;
      case 'popular':
        supabaseQuery = supabaseQuery.order('view_count', { ascending: false });
        break;
      case 'relevance':
      default:
        // PostgreSQL handles relevance ranking via ts_rank internally
        supabaseQuery = supabaseQuery.order('created_at', { ascending: false });
        break;
    }

    supabaseQuery = supabaseQuery.range(offset, offset + limit - 1);

    const { data, error, count } = await supabaseQuery;

    if (error) {
      logger.error({ error, searchQuery }, 'Product search failed');
      throw new AppError('Search failed. Please try again.', 500);
    }

    const result = {
      data: data || [],
      pagination: { page, limit, total: count || 0 },
    };

    // Cache search result briefly
    await this.redis.set(cacheKey, result, SEARCH_CACHE_TTL);

    // Track analytics (non-blocking)
    if (userId) {
      this._trackSearchHistory(userId, searchQuery, count || 0).catch(() => {});
    }
    this._incrementPopularSearch(searchQuery).catch(() => {});

    return result;
  }

  // ─────────────────────────────────────────
  // STORE SEARCH
  // ─────────────────────────────────────────
  async searchStores(query) {
    const { page, limit, offset } = getPaginationParams(query);
    const searchQuery = sanitizeString(query.q);

    const { data, error, count } = await this.supabase
      .from('stores')
      .select(
        `
        id,
        store_name,
        slug,
        logo_url,
        banner_url,
        description,
        location_city,
        total_sales,
        average_rating,
        total_reviews,
        total_followers,
        is_verified,
        created_at,
        categories (
          id,
          name,
          slug
        )
      `,
        { count: 'exact' }
      )
      .eq('is_active', true)
      .eq('is_deleted', false)
      .or(
        `store_name.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`
      )
      .order('average_rating', { ascending: false })
      .order('total_sales', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'Store search failed');
      throw new AppError('Store search failed', 500);
    }

    return {
      data: data || [],
      pagination: { page, limit, total: count || 0 },
    };
  }

  // ─────────────────────────────────────────
  // INSTANT SEARCH SUGGESTIONS (Autocomplete)
  // Returns title suggestions as user types
  // ─────────────────────────────────────────
  async getSuggestions(queryText) {
    const searchTerm = sanitizeString(queryText);

    if (searchTerm.length < 2) return [];

    const cacheKey = `search:suggestions:${searchTerm.toLowerCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    // Query distinct product titles that match prefix
    const { data, error } = await this.supabase
      .from('products')
      .select('title, category_id')
      .eq('status', 'available')
      .eq('is_deleted', false)
      .ilike('title', `${searchTerm}%`)
      .order('view_count', { ascending: false })
      .limit(10);

    if (error) {
      logger.warn({ error }, 'Suggestion query failed');
      return [];
    }

    // Deduplicate and clean suggestions
    const seen = new Set();
    const suggestions = [];

    for (const row of data || []) {
      const suggestion = row.title.trim();
      const lower = suggestion.toLowerCase();

      if (!seen.has(lower)) {
        seen.add(lower);
        suggestions.push(suggestion);
      }

      if (suggestions.length >= 8) break;
    }

    // Cache suggestions for 2 minutes
    await this.redis.set(cacheKey, suggestions, 120);

    return suggestions;
  }

  // ─────────────────────────────────────────
  // POPULAR SEARCHES
  // Uses Redis sorted set — score = search count
  // ─────────────────────────────────────────
  async getPopularSearches(limit = 10) {
    const cacheKey = 'search:popular:list';
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    try {
      // Get top N searches by score (descending)
      const results = await this.redis.client.zrevrange(
        `${this.redis.client.options.keyPrefix || ''}${POPULAR_SEARCHES_KEY}`,
        0,
        limit - 1,
        'WITHSCORES'
      );

      // Redis returns [term, score, term, score, ...] flat array
      const popular = [];
      for (let i = 0; i < results.length; i += 2) {
        popular.push({
          query: results[i],
          count: parseInt(results[i + 1], 10),
        });
      }

      await this.redis.set(cacheKey, popular, 1800); // 30 min cache
      return popular;
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch popular searches');
      return [];
    }
  }

  // ─────────────────────────────────────────
  // GET USER SEARCH HISTORY
  // ─────────────────────────────────────────
  async getUserSearchHistory(userId) {
    const { data, error } = await this.supabase
      .from('search_history')
      .select('id, query, result_count, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(constants.SEARCH_HISTORY_LIMIT);

    if (error) {
      logger.warn({ error }, 'Failed to get search history');
      return [];
    }

    return data || [];
  }

  // ─────────────────────────────────────────
  // CLEAR USER SEARCH HISTORY
  // ─────────────────────────────────────────
  async clearSearchHistory(userId) {
    const { error } = await this.supabase
      .from('search_history')
      .delete()
      .eq('user_id', userId);

    if (error) {
      logger.error({ error }, 'Failed to clear search history');
      throw new AppError('Failed to clear search history', 500);
    }

    return { message: 'Search history cleared' };
  }

  // ─────────────────────────────────────────
  // PRIVATE: Track search in history table
  // ─────────────────────────────────────────
  async _trackSearchHistory(userId, query, resultCount) {
    try {
      // Only keep last N searches — delete oldest if over limit
      const { count } = await this.supabase
        .from('search_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (count >= constants.SEARCH_HISTORY_LIMIT) {
        // Delete oldest entry
        const { data: oldest } = await this.supabase
          .from('search_history')
          .select('id')
          .eq('user_id', userId)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();

        if (oldest) {
          await this.supabase
            .from('search_history')
            .delete()
            .eq('id', oldest.id);
        }
      }

      await this.supabase.from('search_history').insert({
        user_id: userId,
        query,
        result_count: resultCount,
      });
    } catch (err) {
      logger.warn({ err }, 'Search history tracking failed — non-critical');
    }
  }

  // ─────────────────────────────────────────
  // PRIVATE: Increment popular search score
  // ─────────────────────────────────────────
  async _incrementPopularSearch(query) {
    try {
      const normalizedQuery = query.toLowerCase().trim();
      const key = `${this.redis.client.options.keyPrefix || ''}${POPULAR_SEARCHES_KEY}`;

      // ZINCRBY increments score by 1 (creates if not exists)
      await this.redis.client.zincrby(key, 1, normalizedQuery);

      // Keep only top 100 popular searches to prevent unbounded growth
      await this.redis.client.zremrangebyrank(key, 0, -101);
    } catch (err) {
      logger.warn({ err }, 'Popular search increment failed — non-critical');
    }
  }
}

module.exports = SearchService;