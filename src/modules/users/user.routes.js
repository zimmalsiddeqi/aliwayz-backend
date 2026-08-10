'use strict';

const UserController = require('./user.controller');
const { authenticate, optionalAuthenticate } = require('../../middleware/authenticate');
const { sanitizeInput } = require('../../middleware/sanitize');

async function userRoutes(fastify) {
  const ctrl = new UserController(fastify);

  // ─────────────────────────────────────────
  // Protected — own profile management
  // ─────────────────────────────────────────

  fastify.get('/me', {
    preHandler: [authenticate],
    handler: ctrl.getMyProfile.bind(ctrl),
  });

  fastify.put('/me', {
    preHandler: [authenticate, sanitizeInput],
    handler: ctrl.updateProfile.bind(ctrl),
  });

  fastify.put('/me/avatar', {
    preHandler: [authenticate],
    handler: ctrl.uploadAvatar.bind(ctrl),
  });

  fastify.put('/me/location', {
    preHandler: [authenticate, sanitizeInput],
    handler: ctrl.updateLocation.bind(ctrl),
  });

  fastify.put('/me/role', {
    preHandler: [authenticate, sanitizeInput],
    handler: ctrl.updateRole.bind(ctrl),
  });

  fastify.put('/me/fcm-token', {
    preHandler: [authenticate, sanitizeInput],
    handler: ctrl.updateFcmToken.bind(ctrl),
  });

  fastify.get('/me/purchases', {
    preHandler: [authenticate],
    handler: ctrl.getPurchaseHistory.bind(ctrl),
  });

  fastify.get('/me/favorites', {
    preHandler: [authenticate],
    handler: ctrl.getFavoriteProducts.bind(ctrl),
  });

  fastify.get('/me/following', {
    preHandler: [authenticate],
    handler: ctrl.getFollowingStores.bind(ctrl),
  });

  fastify.get('/me/notifications', {
    preHandler: [authenticate],
    handler: ctrl.getNotifications.bind(ctrl),
  });

  fastify.put('/me/notifications/read-all', {
    preHandler: [authenticate],
    handler: ctrl.markAllNotificationsRead.bind(ctrl),
  });

  fastify.put('/me/notifications/:id', {
    preHandler: [authenticate],
    handler: ctrl.markNotificationRead.bind(ctrl),
  });

  fastify.delete('/me', {
    preHandler: [authenticate],
    handler: ctrl.deleteAccount.bind(ctrl),
  });

  // ─────────────────────────────────────────
  // Public — view user profiles
  // ─────────────────────────────────────────

  fastify.get('/:username', {
    preHandler: [optionalAuthenticate],
    handler: ctrl.getPublicProfile.bind(ctrl),
  });
}

module.exports = userRoutes;