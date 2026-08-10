'use strict';

const BadgeEngine = require('./badge.engine');
const BadgeRepository = require('./badge.repository');
const { CACHE_KEYS, CACHE_TTL } = require('../../shared/constants/cacheKeys');
const { BADGE_THRESHOLDS } = require('../../shared/constants/badgeThresholds');
const logger = require('../../shared/utils/logger');

class BadgeService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.engine = new BadgeEngine(supabase, redis);
    this.repo = new BadgeRepository(supabase);
  }

  // ─────────────────────────────────────────
  // GET ALL AVAILABLE BADGES
  // ─────────────────────────────────────────
  async getAllBadges() {
    const cached = await this.redis.get(CACHE_KEYS.BADGE_DEFINITIONS);
    if (cached) return cached;

    const badges = await this.repo.getAllBadges();
    await this.redis.set(
      CACHE_KEYS.BADGE_DEFINITIONS,
      badges,
      CACHE_TTL.BADGE_DEFINITIONS
    );

    return badges;
  }

  // ─────────────────────────────────────────
  // GET USER BADGES
  // ─────────────────────────────────────────
  async getUserBadges(userId) {
    const cacheKey = CACHE_KEYS.USER_BADGES(userId);
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const userBadges = await this.repo.getUserActiveBadges(userId);

    const result = userBadges
      .filter((ub) => ub.badges)
      .map((ub) => ({
        ...ub.badges,
        awarded_at: ub.awarded_at,
        award_reason: ub.award_reason,
      }));

    await this.redis.set(cacheKey, result, CACHE_TTL.USER_BADGES);
    return result;
  }

  // ─────────────────────────────────────────
  // GET USER BADGE HISTORY
  // ─────────────────────────────────────────
  async getUserBadgeHistory(userId) {
    return this.repo.getUserBadgeHistory(userId);
  }

  // ─────────────────────────────────────────
  // GET BADGE PROGRESS
  // Shows how close user is to each badge
  // ─────────────────────────────────────────
  async getBadgeProgress(userId) {
    // Get user stats
    const { data: user } = await this.supabase
      .from('users')
      .select(`
        role,
        phone_verified,
        seller_stats (
          total_sales,
          average_rating,
          total_reviews
        )
      `)
      .eq('id', userId)
      .single();

    const { count: totalPurchases } = await this.supabase
      .from('qr_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('buyer_id', userId)
      .eq('status', 'scanned');

    const stats = {
      total_sales: user?.seller_stats?.total_sales || 0,
      average_rating: user?.seller_stats?.average_rating || 0,
      total_reviews: user?.seller_stats?.total_reviews || 0,
      phone_verified: user?.phone_verified || false,
      total_purchases: totalPurchases || 0,
    };

    // Calculate progress for each badge
    const progress = [
      {
        code: 'verified_seller',
        name: 'Verified Seller',
        requirements: [
          {
            label: 'Phone Verified',
            current: stats.phone_verified ? 1 : 0,
            required: 1,
            met: stats.phone_verified,
          },
          {
            label: 'Sales Completed',
            current: stats.total_sales,
            required: 1,
            met: stats.total_sales >= 1,
          },
        ],
      },
      {
        code: '100_rated',
        name: '100 Rated Seller',
        requirements: [
          {
            label: 'Sales',
            current: Math.min(stats.total_sales, 100),
            required: 100,
            met: stats.total_sales >= 100,
          },
          {
            label: 'Average Rating',
            current: stats.average_rating,
            required: 4.0,
            met: stats.average_rating >= 4.0,
          },
          {
            label: 'Reviews',
            current: Math.min(stats.total_reviews, 80),
            required: 80,
            met: stats.total_reviews >= 80,
          },
        ],
      },
      {
        code: '500_rated',
        name: '500 Rated Seller',
        requirements: [
          {
            label: 'Sales',
            current: Math.min(stats.total_sales, 500),
            required: 500,
            met: stats.total_sales >= 500,
          },
          {
            label: 'Average Rating',
            current: stats.average_rating,
            required: 4.2,
            met: stats.average_rating >= 4.2,
          },
          {
            label: 'Reviews',
            current: Math.min(stats.total_reviews, 400),
            required: 400,
            met: stats.total_reviews >= 400,
          },
        ],
      },
      {
        code: 'top_seller',
        name: 'Top Seller',
        requirements: [
          {
            label: 'Sales',
            current: Math.min(stats.total_sales, 500),
            required: 500,
            met: stats.total_sales >= 500,
          },
          {
            label: 'Average Rating',
            current: stats.average_rating,
            required: 4.5,
            met: stats.average_rating >= 4.5,
          },
          {
            label: 'Phone Verified',
            current: stats.phone_verified ? 1 : 0,
            required: 1,
            met: stats.phone_verified,
          },
        ],
      },
      {
        code: 'trusted_buyer',
        name: 'Trusted Buyer',
        requirements: [
          {
            label: 'Purchases',
            current: Math.min(stats.total_purchases, 10),
            required: 10,
            met: stats.total_purchases >= 10,
          },
        ],
      },
    ];

    return { stats, progress };
  }

  // ─────────────────────────────────────────
  // TRIGGER EVALUATION (admin / manual)
  // ─────────────────────────────────────────
  async triggerEvaluation(userId) {
    return this.engine.evaluateAndAssignBadges(userId, 'manual_trigger');
  }
}

module.exports = BadgeService;