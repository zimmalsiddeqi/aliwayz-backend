'use strict';

const SearchController = require('./search.controller');
const { authenticate, optionalAuthenticate } = require('../../middleware/authenticate');
const { sanitizeInput } = require('../../middleware/sanitize');

async function searchRoutes(fastify) {
  const ctrl = new SearchController(fastify);

  // ─────────────────────────────────────────
  // Public search routes
  // ─────────────────────────────────────────

  // Main product search
  fastify.get('/', {
    config: { rateLimit: { max: 60, timeWindow: '1m' } },
    preHandler: [optionalAuthenticate, sanitizeInput],
    handler: ctrl.searchProducts.bind(ctrl),
  });

  // Store search
  fastify.get('/stores', {
    config: { rateLimit: { max: 60, timeWindow: '1m' } },
    preHandler: [sanitizeInput],
    handler: ctrl.searchStores.bind(ctrl),
  });

  // Autocomplete suggestions
  fastify.get('/suggestions', {
    config: { rateLimit: { max: 120, timeWindow: '1m' } },
    preHandler: [sanitizeInput],
    handler: ctrl.getSuggestions.bind(ctrl),
  });

  // Popular searches (public)
  fastify.get('/popular', {
    handler: ctrl.getPopularSearches.bind(ctrl),
  });

  // ─────────────────────────────────────────
  // Protected — user history
  // ─────────────────────────────────────────

  // Get own search history
  fastify.get('/history', {
    preHandler: [authenticate],
    handler: ctrl.getSearchHistory.bind(ctrl),
  });

  // Clear own search history
  fastify.delete('/history', {
    preHandler: [authenticate],
    handler: ctrl.clearSearchHistory.bind(ctrl),
  });
}

module.exports = searchRoutes;