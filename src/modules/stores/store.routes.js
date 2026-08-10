'use strict';

const StoreController = require('./store.controller');
const { authenticate, optionalAuthenticate } = require('../../middleware/authenticate');
const { requireSeller } = require('../../middleware/authorize');
const { sanitizeInput } = require('../../middleware/sanitize');

async function storeRoutes(fastify) {
  const ctrl = new StoreController(fastify);

  // ─────────────────────────────────────────
  // ✅ NEW: Get my store (seller only)
  // MUST be BEFORE /:slug route to avoid conflict
  // ─────────────────────────────────────────
  fastify.get('/my', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.getMyStore.bind(ctrl),
  });

  // ─────────────────────────────────────────
  // Public routes
  // ─────────────────────────────────────────
  fastify.get('/:slug', {
    preHandler: [optionalAuthenticate],
    handler: ctrl.getStore.bind(ctrl),
  });

  fastify.get('/:slug/products', {
    preHandler: [optionalAuthenticate],
    handler: ctrl.getStoreProducts.bind(ctrl),
  });

  fastify.get('/:id/followers', {
    preHandler: [optionalAuthenticate],
    handler: ctrl.getStoreFollowers.bind(ctrl),
  });

  // ─────────────────────────────────────────
  // Protected — seller required
  // ─────────────────────────────────────────
  fastify.post('/', {
    preHandler: [authenticate, requireSeller, sanitizeInput],
    handler: ctrl.createStore.bind(ctrl),
  });

  fastify.put('/:id', {
    preHandler: [authenticate, requireSeller, sanitizeInput],
    handler: ctrl.updateStore.bind(ctrl),
  });

  fastify.put('/:id/logo', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.uploadLogo.bind(ctrl),
  });

  fastify.put('/:id/banner', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.uploadBanner.bind(ctrl),
  });

  fastify.get('/:id/analytics', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.getStoreAnalytics.bind(ctrl),
  });

  fastify.delete('/:id', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.deleteStore.bind(ctrl),
  });

  // ─────────────────────────────────────────
  // Follow/Unfollow
  // ─────────────────────────────────────────
  fastify.post('/:slug/follow', {
    preHandler: [authenticate],
    handler: ctrl.followStore.bind(ctrl),
  });

  fastify.delete('/:slug/follow', {
    preHandler: [authenticate],
    handler: ctrl.unfollowStore.bind(ctrl),
  });
}

module.exports = storeRoutes;