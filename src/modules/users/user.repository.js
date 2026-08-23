'use strict';

const logger = require('../../shared/utils/logger');

class UserRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Get own full profile
  // ─────────────────────────────────────────
  async getMyProfile(userId) {
    const { data, error } = await this.supabase
      .from('users')
      .select(`
        id,
        email,
        username,
        full_name,
        avatar_url,
        bio,
        phone,
        phone_verified,
        email_verified,
        role,
        account_status,
        auth_provider,
        location_city,
        location_lat,
        location_lng,
        fcm_token,
        seller_verification_status,
        last_active_at,
        created_at,
        seller_stats (
          total_sales,
          total_listings,
          active_listings,
          total_views,
          total_favorites,
          average_rating,
          total_reviews,
          total_followers,
          badge_score
        ),
        user_badges (
          id,
          awarded_at,
          is_active,
          badges (
            id,
            code,
            name,
            description,
            icon_url,
            badge_score
          )
        )
      `)
      .eq('id', userId)
      .eq('is_deleted', false)
      .single();

    if (error) {
      logger.error({ error }, 'getMyProfile failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Get public profile by username
  // ─────────────────────────────────────────
  async getPublicProfile(username) {
    const { data, error } = await this.supabase
      .from('users')
      .select(`
        id,
        username,
        full_name,
        avatar_url,
        bio,
        location_city,
        role,
        created_at,
        seller_stats (
          total_sales,
          active_listings,
          average_rating,
          total_reviews,
          total_followers,
          badge_score
        ),
        user_badges (
          awarded_at,
          is_active,
          badges (
            code,
            name,
            icon_url
          )
        )
      `)
      .eq('username', username)
      .eq('is_deleted', false)
      .eq('account_status', 'active')
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'getPublicProfile failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Update user profile
  // ─────────────────────────────────────────
  async updateProfile(userId, updates) {
    const { data, error } = await this.supabase
      .from('users')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select(`
        id,
        email,
        username,
        full_name,
        avatar_url,
        bio,
        role,
        location_city,
        email_verified,
        phone_verified
      `)
      .single();

    if (error) {
      logger.error({ error }, 'updateProfile failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Check username availability
  // ─────────────────────────────────────────
  async isUsernameTaken(username, excludeUserId = null) {
    let query = this.supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .eq('is_deleted', false);

    if (excludeUserId) {
      query = query.neq('id', excludeUserId);
    }

    const { data, error } = await query.single();

    if (error && error.code === 'PGRST116') return false;
    if (error) throw error;

    return !!data;
  }

  // ─────────────────────────────────────────
  // Get purchase history (products buyer has bought)
  // ─────────────────────────────────────────
  async getPurchaseHistory(userId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('qr_transactions')
      .select(
        `
        id,
        scanned_at,
        created_at,
        products (
          id,
          title,
          slug,
          price,
          currency,
          status,
          product_images (
            cdn_url,
            storage_url,
            is_primary
          )
        ),
        seller:seller_id (
          id,
          username,
          avatar_url
        )
      `,
        { count: 'exact' }
      )
      .eq('buyer_id', userId)
      .eq('status', 'scanned')
      .order('scanned_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getPurchaseHistory failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get user's favorited products
  // ─────────────────────────────────────────
  async getFavoriteProducts(userId, { limit, offset }) {
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
          status,
          condition,
          location_city,
          created_at,
          product_images (
            cdn_url,
            storage_url,
            is_primary
          ),
          stores (
            id,
            store_name,
            slug
          )
        )
      `,
        { count: 'exact' }
      )
      .eq('user_id', userId)
      .eq('products.is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getFavoriteProducts failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get followed stores
  // ─────────────────────────────────────────
  async getFollowingStores(userId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('store_followers')
      .select(
        `
        id,
        created_at,
        stores (
          id,
          store_name,
          slug,
          logo_url,
          location_city,
          average_rating,
          total_sales,
          is_verified
        )
      `,
        { count: 'exact' }
      )
      .eq('follower_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getFollowingStores failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // ─────────────────────────────────────────
  // Hard delete user account and all cascade data completely from database
  // ─────────────────────────────────────────
  async hardDeleteUser(userId) {
    // Get store IDs owned by the user to cascade delete store products and followers
    const { data: userStores } = await this.supabase
      .from('stores')
      .select('id')
      .eq('user_id', userId);

    const storeIds = userStores?.map(s => s.id) || [];

    // 1. Delete products, product images, videos, reviews, and favorites
    const { data: userProducts } = await this.supabase
      .from('products')
      .select('id')
      .eq('seller_id', userId);

    const productIds = userProducts?.map(p => p.id) || [];

    if (productIds.length > 0) {
      await this.supabase.from('product_images').delete().in('product_id', productIds);
      await this.supabase.from('product_videos').delete().in('product_id', productIds);
      await this.supabase.from('favorites').delete().in('product_id', productIds);
      await this.supabase.from('reviews').delete().in('product_id', productIds);
      await this.supabase.from('products').delete().in('id', productIds);
    }

    // 2. Delete store followers for user's stores, or where the user is a follower
    if (storeIds.length > 0) {
      await this.supabase.from('store_followers').delete().in('store_id', storeIds);
      await this.supabase.from('stores').delete().in('id', storeIds);
    }
    await this.supabase.from('store_followers').delete().eq('follower_id', userId);

    // 3. Delete other user-related tables
    await this.supabase.from('store_drafts').delete().eq('user_id', userId);
    await this.supabase.from('seller_verifications').delete().eq('user_id', userId);
    await this.supabase.from('favorites').delete().eq('user_id', userId);
    await this.supabase.from('notifications').delete().eq('user_id', userId);
    await this.supabase.from('reviews').delete().eq('user_id', userId);
    await this.supabase.from('user_badges').delete().eq('user_id', userId);
    await this.supabase.from('seller_stats').delete().eq('user_id', userId);

    // 4. Finally delete the user record from database
    const { error } = await this.supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      logger.error({ error }, 'hardDeleteUser failed');
      throw error;
    }
  }
}

module.exports = UserRepository;