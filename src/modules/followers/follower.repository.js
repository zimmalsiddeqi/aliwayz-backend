'use strict';

const logger = require('../../shared/utils/logger');

class FollowerRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Check if user follows a store
  // ─────────────────────────────────────────
  async isFollowing(followerId, storeId) {
    const { data, error } = await this.supabase
      .from('store_followers')
      .select('id')
      .eq('follower_id', followerId)
      .eq('store_id', storeId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'isFollowing check failed');
      throw error;
    }

    return !!data;
  }

  // ─────────────────────────────────────────
  // Follow a store
  // ─────────────────────────────────────────
  async followStore(followerId, storeId) {
    const { error } = await this.supabase
      .from('store_followers')
      .insert({ follower_id: followerId, store_id: storeId });

    // Ignore unique constraint violations (already following)
    if (error && error.code !== '23505') {
      logger.error({ error }, 'followStore failed');
      throw error;
    }

    // Atomically increment follower count
    await this.supabase.rpc('increment_store_followers', {
      store_id: storeId,
    });
  }

  // ─────────────────────────────────────────
  // Unfollow a store
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

    // Atomically decrement follower count
    await this.supabase.rpc('decrement_store_followers', {
      store_id: storeId,
    });
  }

  // ─────────────────────────────────────────
  // Get all followers of a store (paginated)
  // ─────────────────────────────────────────
  async getStoreFollowers(storeId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('store_followers')
      .select(
        `
        id,
        created_at,
        follower:follower_id (
          id,
          username,
          avatar_url,
          location_city,
          role
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
  // Get all stores a user follows (paginated)
  // ─────────────────────────────────────────
  async getUserFollowedStores(followerId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('store_followers')
      .select(
        `
        id,
        created_at,
        store:store_id (
          id,
          store_name,
          slug,
          logo_url,
          banner_url,
          location_city,
          average_rating,
          total_sales,
          total_followers,
          is_verified,
          is_active
        )
      `,
        { count: 'exact' }
      )
      .eq('follower_id', followerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getUserFollowedStores failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get follower count for a store
  // ─────────────────────────────────────────
  async getFollowerCount(storeId) {
    const { count, error } = await this.supabase
      .from('store_followers')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId);

    if (error) {
      logger.error({ error }, 'getFollowerCount failed');
      return 0;
    }

    return count || 0;
  }

  // ─────────────────────────────────────────
  // Get store owner ID
  // Used to send follow notification
  // ─────────────────────────────────────────
  async getStoreOwnerId(storeId) {
    const { data, error } = await this.supabase
      .from('stores')
      .select('user_id, store_name, slug')
      .eq('id', storeId)
      .eq('is_deleted', false)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'getStoreOwnerId failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Get all follower user IDs for a store
  // Used for price change / new listing notifications
  // ─────────────────────────────────────────
  async getStoreFollowerUserIds(storeId) {
    const { data, error } = await this.supabase
      .from('store_followers')
      .select('follower_id, users:follower_id(id, fcm_token)')
      .eq('store_id', storeId);

    if (error) {
      logger.error({ error }, 'getStoreFollowerUserIds failed');
      return [];
    }

    return data?.map((f) => f.users).filter(Boolean) || [];
  }
}

module.exports = FollowerRepository;