'use strict';

const BadgeController = require('./badge.controller');
const { authenticate } = require('../../middleware/authenticate');
const { requireAdmin } = require('../../middleware/authorize');

async function badgeRoutes(fastify) {
  const ctrl = new BadgeController(fastify);

  // GET /badges — all available badges (public)
  fastify.get('/', {
    handler: ctrl.getAllBadges.bind(ctrl),
  });

  // GET /badges/me/progress — own badge progress
  fastify.get('/me/progress', {
    preHandler: [authenticate],
    handler: ctrl.getMyBadgeProgress.bind(ctrl),
  });

  // GET /badges/user/:userId — user's earned badges (public)
  fastify.get('/user/:userId', {
    handler: ctrl.getUserBadges.bind(ctrl),
  });

  // GET /badges/history/:userId — badge history (auth required)
  fastify.get('/history/:userId', {
    preHandler: [authenticate],
    handler: ctrl.getUserBadgeHistory.bind(ctrl),
  });

  // POST /badges/evaluate/:userId — admin only
  fastify.post('/evaluate/:userId', {
    preHandler: [authenticate, requireAdmin],
    handler: ctrl.triggerEvaluation.bind(ctrl),
  });
}

module.exports = badgeRoutes;