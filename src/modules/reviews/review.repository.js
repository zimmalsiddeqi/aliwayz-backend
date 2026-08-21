'use strict';

const logger = require('../../shared/utils/logger');

class ReviewRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Find eligible QR transaction for review
  // ─────────────────────────────────────────
  async findEligibleTransaction(transactionId, reviewerId) {
    const { data, error } = await this.supabase
      .from('qr_transactions')
      .select(
        'id, product_id, seller_id, buyer_id, status, scanned_at, conversation_id'
      )
      .eq('id', transactionId)
      .eq('status', 'scanned')
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findEligibleTransaction failed');
      throw error;
    }

    if (!data) return null;

    // Reviewer must be participant
    if (data.buyer_id !== reviewerId && data.seller_id !== reviewerId) {
      return null;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Check if already reviewed
  // ─────────────────────────────────────────
  async hasAlreadyReviewed(transactionId, reviewerId) {
    const { data, error } = await this.supabase
      .from('reviews')
      .select('id')
      .eq('qr_transaction_id', transactionId)
      .eq('reviewer_id', reviewerId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }

  // ─────────────────────────────────────────
  // Create review
  // ─────────────────────────────────────────
  async createReview(reviewData) {
    const { data, error } = await this.supabase
      .from('reviews')
      .insert(reviewData)
      .select(`
        id,
        rating,
        comment,
        reviewer_type,
        tag_friendly,
        tag_fast,
        tag_accurate,
        tag_great_comm,
        tag_would_buy_again,
        tag_would_sell_again,
        created_at,
        reviewer:reviewer_id (
          id,
          username,
          avatar_url
        ),
        products (
          id,
          title,
          slug
        )
      `)
      .single();

    if (error) {
      logger.error({ error }, 'createReview failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Get user reviews received (paginated)
  // ─────────────────────────────────────────
  async getUserReviews(userId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('reviews')
      .select(
        `
        id,
        rating,
        comment,
        reviewer_type,
        tag_friendly,
        tag_fast,
        tag_accurate,
        tag_great_comm,
        tag_would_buy_again,
        tag_would_sell_again,
        is_visible,
        created_at,
        reviewer:reviewer_id (
          id,
          username,
          avatar_url
        ),
        products (
          id,
          title,
          slug
        )
      `,
        { count: 'exact' }
      )
      .eq('reviewee_id', userId)
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getUserReviews failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get store reviews (buyer reviews only)
  // ─────────────────────────────────────────
  async getStoreReviews(storeId, { limit, offset }) {
    // 1. Fetch store owner's user ID
    const { data: store, error: storeError } = await this.supabase
      .from('stores')
      .select('user_id')
      .eq('id', storeId)
      .single();

    if (storeError || !store) {
      logger.error({ error: storeError, storeId }, 'getStoreReviews failed to find store');
      throw storeError || new Error('Store not found');
    }

    const ownerId = store.user_id;

    // 2. Fetch all reviews received by the store owner as a seller
    const { data, error, count } = await this.supabase
      .from('reviews')
      .select(
        `
        id,
        rating,
        comment,
        tag_friendly,
        tag_fast,
        tag_accurate,
        tag_great_comm,
        tag_would_buy_again,
        created_at,
        reviewer:reviewer_id (
          id,
          username,
          avatar_url
        ),
        products (
          id,
          title,
          slug
        )
      `,
        { count: 'exact' }
      )
      .eq('reviewee_id', ownerId)
      .eq('reviewer_type', 'buyer')
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getStoreReviews failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get review summary stats for a user
  // ─────────────────────────────────────────
  async getReviewSummary(userId) {
    const { data, error } = await this.supabase
      .from('reviews')
      .select('rating, tag_friendly, tag_fast, tag_accurate, tag_great_comm, tag_would_buy_again, tag_would_sell_again')
      .eq('reviewee_id', userId)
      .eq('is_visible', true);

    if (error) {
      logger.error({ error }, 'getReviewSummary failed');
      throw error;
    }

    if (!data || data.length === 0) {
      return {
        total: 0,
        average_rating: 0,
        rating_breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        popular_tags: {},
      };
    }

    // Calculate rating breakdown
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let ratingSum = 0;

    const tagCounts = {
      friendly: 0,
      fast: 0,
      accurate: 0,
      great_comm: 0,
      would_buy_again: 0,
      would_sell_again: 0,
    };

    for (const review of data) {
      breakdown[review.rating] = (breakdown[review.rating] || 0) + 1;
      ratingSum += review.rating;
      if (review.tag_friendly) tagCounts.friendly++;
      if (review.tag_fast) tagCounts.fast++;
      if (review.tag_accurate) tagCounts.accurate++;
      if (review.tag_great_comm) tagCounts.great_comm++;
      if (review.tag_would_buy_again) tagCounts.would_buy_again++;
      if (review.tag_would_sell_again) tagCounts.would_sell_again++;
    }

    return {
      total: data.length,
      average_rating: Math.round((ratingSum / data.length) * 100) / 100,
      rating_breakdown: breakdown,
      popular_tags: tagCounts,
    };
  }

  // ─────────────────────────────────────────
  // Get reviews written by a user
  // ─────────────────────────────────────────
  async getReviewsWrittenByUser(userId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('reviews')
      .select(
        `
        id,
        rating,
        comment,
        reviewer_type,
        created_at,
        reviewee:reviewee_id (
          id,
          username,
          avatar_url
        ),
        products (
          id,
          title,
          slug
        )
      `,
        { count: 'exact' }
      )
      .eq('reviewer_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getReviewsWrittenByUser failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Update seller average rating via RPC
  // ─────────────────────────────────────────
  async updateSellerRating(sellerId) {
    const { error } = await this.supabase.rpc('update_seller_average_rating', {
      p_seller_id: sellerId,
    });

    if (error) {
      logger.error({ error }, 'updateSellerRating RPC failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Admin: Toggle review visibility
  // ─────────────────────────────────────────
  async setReviewVisibility(reviewId, isVisible) {
    const { error } = await this.supabase
      .from('reviews')
      .update({ is_visible: isVisible })
      .eq('id', reviewId);

    if (error) {
      logger.error({ error }, 'setReviewVisibility failed');
      throw error;
    }
  }
}

module.exports = ReviewRepository;