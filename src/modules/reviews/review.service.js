'use strict';

const ReviewRepository = require('./review.repository');
const { getPaginationParams } = require('../../shared/utils/paginate');
const logger = require('../../shared/utils/logger');
const NotFoundError = require('../../shared/errors/NotFoundError');
const ValidationError = require('../../shared/errors/ValidationError');

class ReviewService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis    = redis;
    this.repo     = new ReviewRepository(supabase);
  }

  // ─────────────────────────────────────────
  // SUBMIT REVIEW (buyer reviews seller OR seller reviews buyer)
  // ─────────────────────────────────────────
  async submitReview(reviewerId, data) {
    const { qr_transaction_id, rating, comment, ...tags } = data;

    // 1. Verify QR transaction is completed (status = 'scanned')
    const transaction = await this.repo.findEligibleTransaction(qr_transaction_id, reviewerId);

    if (!transaction) {
      throw new ValidationError(
        'Review not allowed: Transaction not found, not completed, or you are not a participant.',
        [{ field: 'qr_transaction_id', message: 'Invalid or ineligible transaction' }]
      );
    }

    // 2. Prevent double review for same transaction by same reviewer
    const alreadyReviewed = await this.repo.hasAlreadyReviewed(qr_transaction_id, reviewerId);
    if (alreadyReviewed) {
      throw new ValidationError(
        'You have already submitted a review for this transaction.',
        [{ field: 'qr_transaction_id', message: 'Already reviewed' }]
      );
    }

    // 3. Determine reviewer type and reviewee
    const isBuyer  = transaction.buyer_id  === reviewerId;
    const isSeller = transaction.seller_id === reviewerId;

    const reviewee_id     = isBuyer ? transaction.seller_id : transaction.buyer_id;
    const reviewer_type   = isBuyer ? 'buyer' : 'seller';

    // 4. Build the review record — only columns that exist in the reviews table
    const reviewData = {
      qr_transaction_id,
      product_id:          transaction.product_id,   // NOT NULL in schema
      reviewer_id:         reviewerId,
      reviewee_id,
      reviewer_type,
      rating,
      comment:             comment || null,
      // Tags — only relevant ones per role
      tag_friendly:        tags.tag_friendly        || false,
      tag_fast:            tags.tag_fast            || false,
      tag_accurate:        tags.tag_accurate         || false,
      tag_great_comm:      tags.tag_great_comm       || false,
      tag_would_buy_again: isBuyer  ? (tags.tag_would_buy_again  || false) : false,
      tag_would_sell_again: isSeller ? (tags.tag_would_sell_again || false) : false,
      is_visible: true,
    };

    // 5. Create the review
    const review = await this.repo.createReview(reviewData);

    // 6. Update seller average rating asynchronously (non-blocking)
    const targetSellerId = isBuyer ? reviewee_id : reviewerId;
    this.repo.updateSellerRating(targetSellerId).catch((err) =>
      logger.warn({ err, targetSellerId }, 'updateSellerRating failed — non-critical')
    );

    logger.info(
      { reviewerId, reviewee_id, transactionId: qr_transaction_id, rating },
      `Review submitted: ${reviewer_type} reviewed ${isBuyer ? 'seller' : 'buyer'}`
    );

    return review;
  }

  // ─────────────────────────────────────────
  // GET USER REVIEWS (received)
  // ─────────────────────────────────────────
  async getUserReviews(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getUserReviews(userId, { limit, offset });
    return {
      data,
      pagination: { page, limit, total: count },
    };
  }

  // ─────────────────────────────────────────
  // GET REVIEW SUMMARY
  // ─────────────────────────────────────────
  async getReviewSummary(userId) {
    return this.repo.getReviewSummary(userId);
  }

  // ─────────────────────────────────────────
  // GET STORE REVIEWS
  // ─────────────────────────────────────────
  async getStoreReviews(storeId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getStoreReviews(storeId, { limit, offset });
    return {
      data,
      pagination: { page, limit, total: count },
    };
  }

  // ─────────────────────────────────────────
  // GET REVIEWS WRITTEN BY USER
  // ─────────────────────────────────────────
  async getReviewsWrittenByUser(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getReviewsWrittenByUser(userId, { limit, offset });
    return {
      data,
      pagination: { page, limit, total: count },
    };
  }
}

module.exports = ReviewService;