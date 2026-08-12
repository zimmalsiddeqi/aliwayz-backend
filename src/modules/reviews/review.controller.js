'use strict';

const ReviewService = require('./review.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');
const { createReviewSchema } = require('./review.schema');

class ReviewController {
  constructor(fastify) {
    this.fastify = fastify;
    this.reviewService = new ReviewService(fastify.supabase, fastify.redis);
  }

  _validate(schema, data) {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = (result.error?.errors || []).map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      throw new ValidationError('Validation failed', errors);
    }
    return result.data;
  }

  // POST /reviews
  async submitReview(request, reply) {
    const data = this._validate(createReviewSchema, request.body);
    const review = await this.reviewService.submitReview(request.user.id, data);
    return reply
      .status(201)
      .send(successResponse(review, 'Review submitted successfully'));
  }

  // GET /reviews/user/:userId
  async getUserReviews(request, reply) {
    const result = await this.reviewService.getUserReviews(
      request.params.userId,
      request.query
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /reviews/user/:userId/summary
  async getReviewSummary(request, reply) {
    const summary = await this.reviewService.getReviewSummary(
      request.params.userId
    );
    return reply.send(successResponse(summary));
  }

  // GET /reviews/user/:userId/written
  async getReviewsWritten(request, reply) {
    const result = await this.reviewService.getReviewsWrittenByUser(
      request.params.userId,
      request.query
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /reviews/store/:storeId
  async getStoreReviews(request, reply) {
    const result = await this.reviewService.getStoreReviews(
      request.params.storeId,
      request.query
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }
}

module.exports = ReviewController;