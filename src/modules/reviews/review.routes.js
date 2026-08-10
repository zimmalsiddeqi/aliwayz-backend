'use strict';

const ReviewController = require('./review.controller');
const { authenticate } = require('../../middleware/authenticate');
const { sanitizeInput } = require('../../middleware/sanitize');

async function reviewRoutes(fastify) {
  const ctrl = new ReviewController(fastify);

  // POST /reviews
  fastify.post('/', {
    config: { rateLimit: { max: 100, timeWindow: '1h' } },
    preHandler: [authenticate, sanitizeInput],
    handler: ctrl.submitReview.bind(ctrl),
  });

  // GET /reviews/user/:userId
  fastify.get('/user/:userId', {
    handler: ctrl.getUserReviews.bind(ctrl),
  });

  // GET /reviews/user/:userId/summary
  fastify.get('/user/:userId/summary', {
    handler: ctrl.getReviewSummary.bind(ctrl),
  });

  // GET /reviews/user/:userId/written
  fastify.get('/user/:userId/written', {
    handler: ctrl.getReviewsWritten.bind(ctrl),
  });

  // GET /reviews/store/:storeId
  fastify.get('/store/:storeId', {
    handler: ctrl.getStoreReviews.bind(ctrl),
  });
}

module.exports = reviewRoutes;