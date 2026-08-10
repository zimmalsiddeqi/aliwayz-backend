'use strict';

const logger = require('../../shared/utils/logger');

class BadgeRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Get all active badge definitions
  // ─────────────────────────────────────────
  async getAllBadges() {
    const { data, error } = await this.supabase
      .from('badges')
      .select(
        'id, code, name, description, icon_url, badge_score, min_sales, min_rating, min_reviews, requires_phone_verify, display_order, is_active'
      )
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      logger.error({ error }, 'getAllBadges failed');
      throw error;
    }

    return data || [];
  }

  // ─────────────────────────────────────────
  // Find badge by code
  // ─────────────────────────────────────────
  async findBadgeByCode(code) {
    const { data, error } = await this.supabase
      .from('badges')
      .select('id, code, name, badge_score, is_active')
      .eq('code', code)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findBadgeByCode failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Get user's active badges
  // ─────────────────────────────────────────
  async getUserActiveBadges(userId) {
    const { data, error } = await this.supabase
      .from('user_badges')
      .select(`
        id,
        awarded_at,
        is_active,
        award_reason,
        badges (
          id,
          code,
          name,
          description,
          icon_url,
          badge_score,
          display_order
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('awarded_at', { ascending: true });

    if (error) {
      logger.error({ error }, 'getUserActiveBadges failed');
      throw error;
    }

    return data || [];
  }

  // ─────────────────────────────────────────
  // Get full badge history for a user
  // ─────────────────────────────────────────
  async getUserBadgeHistory(userId) {
    const { data, error } = await this.supabase
      .from('badge_history')
      .select(`
        id,
        action,
        trigger_event,
        snapshot_stats,
        created_at,
        badges (
          id,
          code,
          name,
          icon_url
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      logger.error({ error }, 'getUserBadgeHistory failed');
      throw error;
    }

    return data || [];
  }

  // ─────────────────────────────────────────
  // Check if user has a specific badge
  // ─────────────────────────────────────────
  async userHasBadge(userId, badgeId) {
    const { data, error } = await this.supabase
      .from('user_badges')
      .select('id, is_active')
      .eq('user_id', userId)
      .eq('badge_id', badgeId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? { exists: true, is_active: data.is_active } : null;
  }

  // ─────────────────────────────────────────
  // Upsert user badge (assign or reactivate)
  // ─────────────────────────────────────────
  async upsertUserBadge(userId, badgeId, reason, triggeredBy) {
    const { data, error } = await this.supabase
      .from('user_badges')
      .upsert(
        {
          user_id: userId,
          badge_id: badgeId,
          awarded_at: new Date().toISOString(),
          is_active: true,
          award_reason: reason,
        },
        { onConflict: 'user_id,badge_id' }
      )
      .select('id')
      .single();

    if (error) {
      logger.error({ error }, 'upsertUserBadge failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Revoke user badge
  // ─────────────────────────────────────────
  async revokeUserBadge(userId, badgeId) {
    const { error } = await this.supabase
      .from('user_badges')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('badge_id', badgeId);

    if (error) {
      logger.error({ error }, 'revokeUserBadge failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Insert badge history record
  // ─────────────────────────────────────────
  async insertBadgeHistory(userId, badgeId, action, triggerEvent, snapshotStats) {
    const { error } = await this.supabase
      .from('badge_history')
      .insert({
        user_id: userId,
        badge_id: badgeId,
        action,
        trigger_event: triggerEvent,
        snapshot_stats: snapshotStats,
      });

    if (error) {
      logger.error({ error }, 'insertBadgeHistory failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Get all sellers for periodic batch evaluation
  // Returns IDs of active sellers only
  // ─────────────────────────────────────────
  async getAllActiveSellersForEvaluation() {
    const { data, error } = await this.supabase
      .from('users')
      .select('id')
      .in('role', ['seller', 'both'])
      .eq('account_status', 'active')
      .eq('is_deleted', false);

    if (error) {
      logger.error({ error }, 'getAllActiveSellersForEvaluation failed');
      throw error;
    }

    return data?.map((u) => u.id) || [];
  }

  // ─────────────────────────────────────────
  // Update badge score in seller_stats
  // ─────────────────────────────────────────
  async updateBadgeScore(userId, score) {
    const { error } = await this.supabase
      .from('seller_stats')
      .update({
        badge_score: score,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      logger.error({ error }, 'updateBadgeScore failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Admin: Create new badge definition
  // ─────────────────────────────────────────
  async createBadge(badgeData) {
    const { data, error } = await this.supabase
      .from('badges')
      .insert(badgeData)
      .select('id, code, name, badge_score, display_order, is_active')
      .single();

    if (error) {
      logger.error({ error }, 'createBadge failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Admin: Update badge definition
  // ─────────────────────────────────────────
  async updateBadge(badgeId, updates) {
    const { data, error } = await this.supabase
      .from('badges')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', badgeId)
      .select('id, code, name, badge_score, is_active')
      .single();

    if (error) {
      logger.error({ error }, 'updateBadge failed');
      throw error;
    }

    return data;
  }
}

module.exports = BadgeRepository;