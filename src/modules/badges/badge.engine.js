'use strict';

const logger = require('../../shared/utils/logger');
const { BADGE_THRESHOLDS } = require('../../shared/constants/badgeThresholds');
const { CACHE_KEYS, CACHE_TTL } = require('../../shared/constants/cacheKeys');
const NotificationService = require('../notifications/notification.service');
const constants = require('../../config/constants');

class BadgeEngine {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.notificationService = new NotificationService(supabase, redis);
  }

  // ─────────────────────────────────────────
  // MAIN ENTRY POINT
  // Evaluates all badges for a user based on trigger event
  // ─────────────────────────────────────────
  async evaluateAndAssignBadges(userId, triggerEvent) {
    try {
      // Get current user stats
      const stats = await this._getUserStats(userId);
      if (!stats) return;

      // Get all badge definitions
      const badgeDefinitions = await this._getBadgeDefinitions();

      // Get badges user currently holds
      const currentBadges = await this._getUserCurrentBadges(userId);
      const currentBadgeCodes = new Set(currentBadges.map((b) => b.code));

      const newlyAssigned = [];
      const toRevoke = [];

      // Evaluate each badge
      for (const badge of badgeDefinitions) {
        const meetsRequirements = this._evaluateBadgeCriteria(badge, stats);

        if (meetsRequirements && !currentBadgeCodes.has(badge.code)) {
          // User qualifies but doesn't have badge — assign it
          await this._assignBadge(userId, badge, triggerEvent, stats);
          newlyAssigned.push(badge);
        } else if (!meetsRequirements && currentBadgeCodes.has(badge.code)) {
          // User no longer qualifies — revoke badge
          // Exception: never revoke badges they earned historically
          // Only revoke dynamic badges (100/500 rated, top_seller)
          if (this._isBadgeRevocable(badge.code)) {
            toRevoke.push(badge);
          }
        }
      }

      // Revoke badges user no longer qualifies for
      for (const badge of toRevoke) {
        await this._revokeBadge(userId, badge, triggerEvent, stats);
      }

      // Update composite badge score in seller_stats
      await this._updateBadgeScore(userId);

      // Invalidate badge cache
      await this.redis.del(CACHE_KEYS.USER_BADGES(userId));

      // Send notifications for newly assigned badges
      for (const badge of newlyAssigned) {
        await this.notificationService.createNotification({
          userId,
          type: constants.NOTIFICATION_TYPES.BADGE_EARNED,
          title: `Badge Earned: ${badge.name} 🏆`,
          body: `Congratulations! You've earned the ${badge.name} badge.`,
          data: { badgeCode: badge.code, badgeName: badge.name },
        });

        logger.info(
          { userId, badgeCode: badge.code, triggerEvent },
          'Badge assigned'
        );
      }

      return { assigned: newlyAssigned, revoked: toRevoke };
    } catch (err) {
      logger.error({ err, userId, triggerEvent }, 'Badge evaluation failed');
      // Never throw — badge evaluation is non-critical
    }
  }

  // ─────────────────────────────────────────
  // EVALUATE BADGE CRITERIA
  // Returns true if user meets all requirements
  // ─────────────────────────────────────────
  _evaluateBadgeCriteria(badge, stats) {
    switch (badge.code) {
      case 'new_seller':
        // Only assigned to new sellers with no reviews
        return (stats.role === 'seller' || stats.role === 'both') && stats.total_reviews === 0;

      case 'verified_seller':
        return (
          stats.phone_verified === true &&
          stats.total_sales >= 1
        );

      case '100_rated':
        return (
          stats.total_sales >= BADGE_THRESHOLDS.RATED_100.minSales &&
          stats.average_rating >= BADGE_THRESHOLDS.RATED_100.minRating &&
          stats.total_reviews >= BADGE_THRESHOLDS.RATED_100.minReviews
        );

      case '500_rated':
        return (
          stats.total_sales >= BADGE_THRESHOLDS.RATED_500.minSales &&
          stats.average_rating >= BADGE_THRESHOLDS.RATED_500.minRating &&
          stats.total_reviews >= BADGE_THRESHOLDS.RATED_500.minReviews
        );

      case 'top_seller':
        return (
          stats.total_sales >= BADGE_THRESHOLDS.TOP_SELLER.minSales &&
          stats.average_rating >= BADGE_THRESHOLDS.TOP_SELLER.minRating &&
          stats.total_reviews >= BADGE_THRESHOLDS.TOP_SELLER.minReviews &&
          stats.phone_verified === true &&
          this._isRecentlyActive(stats.last_active_at)
        );

      case 'trusted_buyer':
        return (
          stats.total_purchases >= BADGE_THRESHOLDS.TRUSTED_BUYER.minPurchases &&
          stats.buyer_average_rating >= BADGE_THRESHOLDS.TRUSTED_BUYER.minRating
        );

      default:
        return false;
    }
  }

  // ─────────────────────────────────────────
  // CHECK IF BADGE IS REVOCABLE
  // Permanent badges (new_seller) are never revoked
  // ─────────────────────────────────────────
  _isBadgeRevocable(badgeCode) {
    const nonRevocable = [];
    return !nonRevocable.includes(badgeCode);
  }

  // ─────────────────────────────────────────
  // CHECK RECENT ACTIVITY
  // Top seller requires active within 30 days
  // ─────────────────────────────────────────
  _isRecentlyActive(lastActiveAt) {
    if (!lastActiveAt) return false;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return new Date(lastActiveAt) > thirtyDaysAgo;
  }

  // ─────────────────────────────────────────
  // GET USER STATS (for evaluation)
  // Joins users + seller_stats + purchase count
  // ─────────────────────────────────────────
  async _getUserStats(userId) {
    const { data, error } = await this.supabase
      .from('users')
      .select(`
        id,
        role,
        phone_verified,
        last_active_at,
        seller_stats (
          total_sales,
          average_rating,
          total_reviews,
          badge_score
        )
      `)
      .eq('id', userId)
      .eq('is_deleted', false)
      .single();

    if (error) {
      logger.error({ error }, '_getUserStats failed');
      return null;
    }

    // Count total purchases (buyer side)
    const { count: totalPurchases } = await this.supabase
      .from('qr_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('buyer_id', userId)
      .eq('status', 'scanned');

    // Get buyer average rating received
    const { data: buyerRating } = await this.supabase
      .from('reviews')
      .select('rating')
      .eq('reviewee_id', userId)
      .eq('reviewer_type', 'seller')
      .eq('is_visible', true);

    const buyerAvgRating =
      buyerRating && buyerRating.length > 0
        ? buyerRating.reduce((sum, r) => sum + r.rating, 0) / buyerRating.length
        : 0;

    return {
      userId: data.id,
      role: data.role,
      phone_verified: data.phone_verified,
      last_active_at: data.last_active_at,
      total_sales: data.seller_stats?.total_sales || 0,
      average_rating: data.seller_stats?.average_rating || 0,
      total_reviews: data.seller_stats?.total_reviews || 0,
      total_purchases: totalPurchases || 0,
      buyer_average_rating: Math.round(buyerAvgRating * 100) / 100,
    };
  }

  // ─────────────────────────────────────────
  // GET BADGE DEFINITIONS FROM DB (cached)
  // ─────────────────────────────────────────
  async _getBadgeDefinitions() {
    const cached = await this.redis.get(CACHE_KEYS.BADGE_DEFINITIONS);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .from('badges')
      .select('id, code, name, description, icon_url, badge_score, min_sales, min_rating, min_reviews, requires_phone_verify')
      .eq('is_active', true)
      .order('badge_score', { ascending: true });

    if (error) {
      logger.error({ error }, '_getBadgeDefinitions failed');
      return Object.values(BADGE_THRESHOLDS); // Fallback to constants
    }

    await this.redis.set(CACHE_KEYS.BADGE_DEFINITIONS, data, CACHE_TTL.BADGE_DEFINITIONS);
    return data;
  }

  // ─────────────────────────────────────────
  // GET USER'S CURRENT ACTIVE BADGES
  // ─────────────────────────────────────────
  async _getUserCurrentBadges(userId) {
    const { data, error } = await this.supabase
      .from('user_badges')
      .select('badge_id, is_active, badges(code, name)')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      logger.error({ error }, '_getUserCurrentBadges failed');
      return [];
    }

    return data?.map((ub) => ub.badges).filter(Boolean) || [];
  }

  // ─────────────────────────────────────────
  // ASSIGN BADGE TO USER
  // ─────────────────────────────────────────
  async _assignBadge(userId, badge, triggerEvent, stats) {
    // Upsert user_badge (reactivate if previously revoked)
    const { error: upsertError } = await this.supabase
      .from('user_badges')
      .upsert(
        {
          user_id: userId,
          badge_id: badge.id,
          awarded_at: new Date().toISOString(),
          is_active: true,
          award_reason: `Assigned via ${triggerEvent} event`,
        },
        { onConflict: 'user_id,badge_id' }
      );

    if (upsertError) {
      logger.error({ upsertError, userId, badgeCode: badge.code }, 'Badge upsert failed');
      return;
    }

    // Record in badge history
    await this.supabase.from('badge_history').insert({
      user_id: userId,
      badge_id: badge.id,
      action: 'awarded',
      trigger_event: triggerEvent,
      snapshot_stats: {
        total_sales: stats.total_sales,
        average_rating: stats.average_rating,
        total_reviews: stats.total_reviews,
        total_purchases: stats.total_purchases,
        phone_verified: stats.phone_verified,
      },
    });
  }

  // ─────────────────────────────────────────
  // REVOKE BADGE FROM USER
  // ─────────────────────────────────────────
  async _revokeBadge(userId, badge, triggerEvent, stats) {
    const { error } = await this.supabase
      .from('user_badges')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('badge_id', badge.id);

    if (error) {
      logger.error({ error, userId, badgeCode: badge.code }, 'Badge revoke failed');
      return;
    }

    // Record revocation in history
    await this.supabase.from('badge_history').insert({
      user_id: userId,
      badge_id: badge.id,
      action: 'revoked',
      trigger_event: triggerEvent,
      snapshot_stats: {
        total_sales: stats.total_sales,
        average_rating: stats.average_rating,
        total_reviews: stats.total_reviews,
      },
    });

    logger.info({ userId, badgeCode: badge.code }, 'Badge revoked');
  }

  // ─────────────────────────────────────────
  // UPDATE COMPOSITE BADGE SCORE
  // Used for seller ranking algorithm
  // ─────────────────────────────────────────
  async _updateBadgeScore(userId) {
    // Sum of badge_score values for all active badges
    const { data, error } = await this.supabase
      .from('user_badges')
      .select('badges(badge_score)')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) return;

    const totalScore = data?.reduce(
      (sum, ub) => sum + (ub.badges?.badge_score || 0),
      0
    ) || 0;

    await this.supabase
      .from('seller_stats')
      .update({ badge_score: totalScore, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }
}

module.exports = BadgeEngine;