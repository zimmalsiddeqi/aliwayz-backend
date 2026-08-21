'use strict';

const AdminController = require('./admin.controller');
const { authenticate } = require('../../middleware/authenticate');
const { requireAdmin, requireVerificationOfficer } = require('../../middleware/authorize');
const { sanitizeInput } = require('../../middleware/sanitize');

async function adminRoutes(fastify) {
  const ctrl = new AdminController(fastify);

  // All admin routes require authentication + admin role
  const adminGuard = [authenticate, requireAdmin];

  // Dashboard
  fastify.get('/dashboard', {
    preHandler: adminGuard,
    handler: ctrl.getDashboard.bind(ctrl),
  });

  // Users
  fastify.get('/users', { preHandler: adminGuard, handler: ctrl.getAllUsers.bind(ctrl) });
  fastify.get('/users/:id', { preHandler: adminGuard, handler: ctrl.getUserDetail.bind(ctrl) });
  fastify.put('/users/:id/status', {
    preHandler: [...adminGuard, sanitizeInput],
    handler: ctrl.updateUserStatus.bind(ctrl),
  });
  fastify.delete('/users/:id', { preHandler: adminGuard, handler: ctrl.deleteUser.bind(ctrl) });

  // Stores
  fastify.get('/stores', { preHandler: adminGuard, handler: ctrl.getAllStores.bind(ctrl) });
  fastify.put('/stores/:id/verify', {
    preHandler: [...adminGuard, sanitizeInput],
    handler: ctrl.verifyStore.bind(ctrl),
  });

  // Seller Verification Management
  fastify.get('/verifications', {
    preHandler: adminGuard,
    handler: ctrl.getPendingVerifications.bind(ctrl),
  });
  fastify.put('/verifications/:id', {
    preHandler: [authenticate, requireVerificationOfficer, sanitizeInput],
    handler: ctrl.reviewVerification.bind(ctrl),
  });

  // Products
  fastify.get('/products', { preHandler: adminGuard, handler: ctrl.getAllProducts.bind(ctrl) });
  fastify.put('/products/:id/feature', {
    preHandler: [...adminGuard, sanitizeInput],
    handler: ctrl.featureProduct.bind(ctrl),
  });
  fastify.delete('/products/:id', {
    preHandler: [...adminGuard, sanitizeInput],
    handler: ctrl.deleteProduct.bind(ctrl),
  });

  // Push Notifications
  fastify.post('/notifications/push', {
    preHandler: [...adminGuard, sanitizeInput],
    handler: ctrl.sendBroadcast.bind(ctrl),
  });

  // Admin Logs
  fastify.get('/logs', { preHandler: adminGuard, handler: ctrl.getAdminLogs.bind(ctrl) });
}

module.exports = adminRoutes;