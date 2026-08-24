'use strict';

const logger = require('../../shared/utils/logger');

class FavoriteRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Check if product is favorited by user
  // ─────────────────────────────────────────
  async isFavorited(userId, productId) {
    const { data, error } = await this.supabase
      .from('favorites')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'isFavorited check failed');
      throw error;
    }

    return !!data;
  }

  // ─────────────────────────────────────────
  // Add to favorites
  // ─────────────────────────────────────────
  async addFavorite(userId, productId) {
    const { error } = await this.supabase
      .from('favorites')
      .insert({ user_id: userId, product_id: productId });

    // Ignore duplicate inserts
    if (error && error.code !== '23505') {
      logger.error({ error }, 'addFavorite failed');
      throw error;
    }

    // Increment product favorite count atomically
    await this.supabase.rpc('increment_product_favorite_count', {
      product_id: productId,
    });
  }

  // ─────────────────────────────────────────
  // Remove from favorites
  // ─────────────────────────────────────────
  async removeFavorite(userId, productId) {
    const { error } = await this.supabase
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);

    if (error) {
      logger.error({ error }, 'removeFavorite failed');
      throw error;
    }

    // Decrement product favorite count atomically
    await this.supabase.rpc('decrement_product_favorite_count', {
      product_id: productId,
    });
  }

  // ─────────────────────────────────────────
  // Get user's favorite products (paginated)
  // ─────────────────────────────────────────
  async getUserFavorites(userId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('favorites')
      .select(
        `
        id,
        created_at,
        products (
          id,
          title,
          slug,
          price,
          currency,
          condition,
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
            is_verified
          ),
          users:seller_id (
            id,
            username,
            avatar_url
          )
        )
      `,
        { count: 'exact' }
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getUserFavorites failed');
      throw error;
    }

    // Filter out deleted/unavailable products
    const filteredData = (data || []).filter(
      (f) => f.products && !f.products.is_deleted
    );

    return { data: filteredData, count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get all users who favorited a product
  // Used for price change notifications
  // ─────────────────────────────────────────
  async getProductFavoriters(productId) {
    const { data, error } = await this.supabase
      .from('favorites')
      .select('user_id, users:user_id(id, fcm_token)')
      .eq('product_id', productId);

    if (error) {
      logger.error({ error }, 'getProductFavoriters failed');
      return [];
    }

    return data?.map((f) => f.users).filter(Boolean) || [];
  }

  // ─────────────────────────────────────────
  // Get favorite count for a product
  // ─────────────────────────────────────────
  async getFavoriteCount(productId) {
    const { count, error } = await this.supabase
      .from('favorites')
      .select('*', { count: 'exact', head: true })
      .eq('product_id', productId);

    if (error) {
      logger.error({ error }, 'getFavoriteCount failed');
      return 0;
    }

    return count || 0;
  }

  // ─────────────────────────────────────────
  // Get product basic info for validation
  // ─────────────────────────────────────────
  async getProductBasic(productId) {
    const { data, error } = await this.supabase
      .from('products')
      .select('id, seller_id, status, is_deleted, title')
      .eq('id', productId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'getProductBasic failed');
      throw error;
    }

    return data || null;
  }
}

module.exports = FavoriteRepository;