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

  // DELETE /notifications/:id
  fastify.delete('/:id', {
    preHandler: [authenticate],
    handler: ctrl.deleteNotification.bind(ctrl),
  });

  // DELETE /notifications
  fastify.delete('/', {
    preHandler: [authenticate],
    handler: ctrl.deleteAllNotifications.bind(ctrl),
  });

  // DELETE /notifications/clear-all
  fastify.delete('/clear-all', {
    preHandler: [authenticate],
    handler: ctrl.deleteAllNotifications.bind(ctrl),
  });
}

module.exports = notificationRoutes;