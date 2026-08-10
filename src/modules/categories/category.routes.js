'use strict';

const CategoryController = require('./category.controller');
const { authenticate } = require('../../middleware/authenticate');
const { requireAdmin } = require('../../middleware/authorize');
const { sanitizeInput } = require('../../middleware/sanitize');

async function categoryRoutes(fastify) {
  const ctrl = new CategoryController(fastify);

  // ─────────────────────────────────────────
  // Public routes
  // ─────────────────────────────────────────

  // GET /categories — full tree structure
  fastify.get('/', {
    handler: ctrl.getCategoryTree.bind(ctrl),
  });

  // GET /categories/flat — flat list for mobile dropdowns
  fastify.get('/flat', {
    handler: ctrl.getAllCategoriesFlat.bind(ctrl),
  });

  // GET /categories/:slug — category detail + products
  fastify.get('/:slug', {
    handler: ctrl.getCategoryWithProducts.bind(ctrl),
  });

  // ─────────────────────────────────────────
  // Admin only routes
  // ─────────────────────────────────────────

  // POST /categories
  fastify.post('/', {
    preHandler: [authenticate, requireAdmin, sanitizeInput],
    handler: ctrl.createCategory.bind(ctrl),
  });

  // PUT /categories/:id
  fastify.put('/:id', {
    preHandler: [authenticate, requireAdmin, sanitizeInput],
    handler: ctrl.updateCategory.bind(ctrl),
  });

  // DELETE /categories/:id
  fastify.delete('/:id', {
    preHandler: [authenticate, requireAdmin],
    handler: ctrl.deleteCategory.bind(ctrl),
  });
}

module.exports = categoryRoutes;