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
  // Soft delete user account
  // ─────────────────────────────────────────
  async softDeleteUser(userId) {
    const { error } = await this.supabase
      .from('users')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        // Anonymize PII
        email: `deleted_${userId}@deleted.invalid`,
        username: `deleted_${userId.substring(0, 8)}`,
        full_name: null,
        bio: null,
        phone: null,
        avatar_url: null,
        fcm_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      logger.error({ error }, 'softDeleteUser failed');
      throw error;
    }
  }
}

module.exports = UserRepository;