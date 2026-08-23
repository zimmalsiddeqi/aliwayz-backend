'use strict';

const logger = require('../../shared/utils/logger');

class StoreRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Find store by owner user ID
  // ─────────────────────────────────────────
  async findStoreByUserId(userId) {
    const { data, error } = await this.supabase
      .from('stores')
      .select('id, store_name, slug, is_active, is_deleted')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findStoreByUserId failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Find store by slug (public view)
  // ─────────────────────────────────────────
  async findStoreBySlug(slug) {
    const { data, error } = await this.supabase
      .from('stores')
      .select(`
        id,
        store_name,
        slug,
        logo_url,
        banner_url,
        description,
        location_city,
        location_lat,
        location_lng,
        social_instagram,
        social_facebook,
        social_tiktok,
        total_sales,
        total_followers,
        average_rating,
        total_reviews,
        is_verified,
        is_active,
        created_at,
        categories (
          id,
          name,
          slug
        ),
        users:user_id (
          id,
          username,
          avatar_url,
          member_since:created_at
        ),
        user_badges:users!user_id (
          user_badges (
            is_active,
            badges (
              code,
              name,
              icon_url
            )
          )
        )
      `)
      .eq('slug', slug)
      .eq('is_deleted', false)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findStoreBySlug failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Find store by ID (owner operations)
  // ─────────────────────────────────────────
  async findStoreById(storeId) {
    const { data, error } = await this.supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .eq('is_deleted', false)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findStoreById failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Create store
  // ─────────────────────────────────────────
  async createStore(storeData) {
    const { data, error } = await this.supabase
      .from('stores')
      .insert(storeData)
      .select(`
        id,
        store_name,
        slug,
        logo_url,
        banner_url,
        description,
        location_city,
        is_verified,
        created_at
      `)
      .single();

    if (error) {
      logger.error({ error }, 'createStore failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Update store
  // ─────────────────────────────────────────
  async updateStore(storeId, updates) {
    const { data, error } = await this.supabase
      .from('stores')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', storeId)
      .select(`
        id,
        store_name,
        slug,
        logo_url,
        banner_url,
        description,
        location_city,
        is_verified
      `)
      .single();

    if (error) {
      logger.error({ error }, 'updateStore failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Get store products (paginated)
  // ─────────────────────────────────────────
  async getStoreProducts(storeId, { limit, offset, status = 'available' }) {
    let query = this.supabase
      .from('products')
      .select(
        `
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
        )
      `,
        { count: 'exact' }
      )
      .eq('store_id', storeId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Guests only see available products
    // Owners can filter by status
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error({ error }, 'getStoreProducts failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get store analytics (owner only)
  // ─────────────────────────────────────────
  async getStoreAnalytics(storeId, userId) {
    // Views last 30 days
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    const [
      { data: stats },
      { count: viewsLast30 },
      { count: favoritesLast30 },
      { data: recentSales },
    ] = await Promise.all([
      this.supabase
        .from('seller_stats')
        .select('*')
        .eq('user_id', userId)
        .single(),

      this.supabase
        .from('product_views')
        .select('*', { count: 'exact', head: true })
        .eq('products.store_id', storeId)
        .gte('created_at', thirtyDaysAgo),

      this.supabase
        .from('favorites')
        .select('*', { count: 'exact', head: true })
        .eq('products.store_id', storeId)
        .gte('created_at', thirtyDaysAgo),

      this.supabase
        .from('qr_transactions')
        .select('id, created_at, products(title, price)')
        .eq('seller_id', userId)
        .eq('status', 'scanned')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    return {
      overview: stats,
      last_30_days: {
        views: viewsLast30 || 0,
        favorites: favoritesLast30 || 0,
      },
      recent_sales: recentSales || [],
    };
  }

  // ─────────────────────────────────────────
  // Check if user follows store
  // ─────────────────────────────────────────
  async isFollowing(followerId, storeId) {
    const { data, error } = await this.supabase
      .from('store_followers')
      .select('id')
      .eq('follower_id', followerId)
      .eq('store_id', storeId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }

  // ─────────────────────────────────────────
  // Follow store
  // ─────────────────────────────────────────
  async followStore(followerId, storeId) {
    const { error } = await this.supabase
      .from('store_followers')
      .insert({ follower_id: followerId, store_id: storeId });

    if (error && error.code !== '23505') {
      // 23505 = unique violation (already following)
      logger.error({ error }, 'followStore failed');
      throw error;
    }

    // Increment follower count
    await this.supabase.rpc('increment_store_followers', { store_id: storeId });
  }

  // ─────────────────────────────────────────
  // Unfollow store
  // ─────────────────────────────────────────
  async unfollowStore(followerId, storeId) {
    const { error } = await this.supabase
      .from('store_followers')
      .delete()
      .eq('follower_id', followerId)
      .eq('store_id', storeId);

    if (error) {
      logger.error({ error }, 'unfollowStore failed');
      throw error;
    }

    // Decrement follower count
    await this.supabase.rpc('decrement_store_followers', { store_id: storeId });
  }

  // ─────────────────────────────────────────
  // Get store followers list
  // ─────────────────────────────────────────
  async getStoreFollowers(storeId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('store_followers')
      .select(
        `
        id,
        created_at,
        users:follower_id (
          id,
          username,
          avatar_url,
          location_city
        )
      `,
        { count: 'exact' }
      )
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getStoreFollowers failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Soft delete store
  // ─────────────────────────────────────────
  async softDeleteStore(storeId) {
    const { error } = await this.supabase
      .from('stores')
      .update({
        is_deleted: true,
        is_active: false,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', storeId);

    if (error) {
      logger.error({ error }, 'softDeleteStore failed');
      throw error;
    }

    // Cascade: Hard delete all products and associated images/videos/favorites/reviews completely from database
    const { data: storeProducts } = await this.supabase
      .from('products')
      .select('id')
      .eq('store_id', storeId);

    const productIds = storeProducts?.map(p => p.id) || [];

    if (productIds.length > 0) {
      await this.supabase.from('product_images').delete().in('product_id', productIds);
      await this.supabase.from('product_videos').delete().in('product_id', productIds);
      await this.supabase.from('favorites').delete().in('product_id', productIds);
      await this.supabase.from('reviews').delete().in('product_id', productIds);
      await this.supabase.from('products').delete().in('id', productIds);
    }
  }
}

module.exports = StoreRepository;