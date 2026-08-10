'use strict';

const ProductController = require('./product.controller');
const { authenticate, optionalAuthenticate } = require('../../middleware/authenticate');
const { requireSeller } = require('../../middleware/authorize');
const { sanitizeInput } = require('../../middleware/sanitize');

async function productRoutes(fastify) {
  const ctrl = new ProductController(fastify);

  // ─────────────────────────────────────────
  // Public feed endpoints (no auth needed)
  // ─────────────────────────────────────────
  fastify.get('/feed/trending', {
    handler: ctrl.getTrendingFeed.bind(ctrl),
  });

  fastify.get('/feed/recent', {
    handler: ctrl.getRecentFeed.bind(ctrl),
  });

  fastify.get('/feed/nearby', {
    handler: ctrl.getNearbyFeed.bind(ctrl),
  });

  fastify.get('/feed/recommended', {
    preHandler: [optionalAuthenticate],
    handler: ctrl.getRecommendedFeed.bind(ctrl),
  });

  // ─────────────────────────────────────────
  // Public browse + product detail
  // ─────────────────────────────────────────
  fastify.get('/', {
    handler: ctrl.browseProducts.bind(ctrl),
  });

  fastify.get('/:id', {
    preHandler: [optionalAuthenticate],
    handler: ctrl.getProduct.bind(ctrl),
  });

  // ─────────────────────────────────────────
  // Protected — seller required
  // ─────────────────────────────────────────
  fastify.post('/', {
    preHandler: [authenticate, requireSeller, sanitizeInput],
    handler: ctrl.createProduct.bind(ctrl),
  });

  fastify.put('/:id', {
    preHandler: [authenticate, requireSeller, sanitizeInput],
    handler: ctrl.updateProduct.bind(ctrl),
  });

  fastify.put('/:id/status', {
    preHandler: [authenticate, requireSeller, sanitizeInput],
    handler: ctrl.updateStatus.bind(ctrl),
  });

  fastify.delete('/:id', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.deleteProduct.bind(ctrl),
  });

  fastify.post('/:id/images', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.uploadImages.bind(ctrl),
  });

  fastify.delete('/:id/images/:imageId', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.deleteImage.bind(ctrl),
  });

  fastify.post('/:id/video', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.uploadVideo.bind(ctrl),
  });

  // ─────────────────────────────────────────
  // Protected — any authenticated user
  // ─────────────────────────────────────────
  fastify.post('/:id/favorite', {
    preHandler: [authenticate],
    handler: ctrl.favoriteProduct.bind(ctrl),
  });

  fastify.delete('/:id/favorite', {
    preHandler: [authenticate],
    handler: ctrl.unfavoriteProduct.bind(ctrl),
  });
}

module.exports = productRoutes;