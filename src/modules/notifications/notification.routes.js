'use strict';

const NotificationController = require('./notification.controller');
const { authenticate } = require('../../middleware/authenticate');

async function notificationRoutes(fastify) {
  const ctrl = new NotificationController(fastify);

  // GET /notifications
  fastify.get('/', {
    preHandler: [authenticate],
    handler: ctrl.getNotifications.bind(ctrl),
  });

  // PUT /notifications/read-all
  fastify.put('/read-all', {
    preHandler: [authenticate],
    handler: ctrl.markAllAsRead.bind(ctrl),
  });

  // PUT /notifications/:id/read
  fastify.put('/:id/read', {
    preHandler: [authenticate],
    handler: ctrl.markAsRead.bind(ctrl),
  });
}

module.exports = notificationRoutes;