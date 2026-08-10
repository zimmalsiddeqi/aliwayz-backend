'use strict';

const NotificationService = require('./notification.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');

class NotificationController {
  constructor(fastify) {
    this.fastify = fastify;
    this.notificationService = new NotificationService(
      fastify.supabase,
      fastify.redis
    );
  }

  // GET /notifications
  async getNotifications(request, reply) {
    const result = await this.notificationService.getUserNotifications(
      request.user.id,
      request.query
    );
    return reply.send({
      ...paginatedResponse(result.data, result.pagination),
      unread_count: result.unread_count,
    });
  }

  // PUT /notifications/:id/read
  async markAsRead(request, reply) {
    const result = await this.notificationService.markAsRead(
      request.user.id,
      request.params.id
    );
    return reply.send(successResponse(result));
  }

  // PUT /notifications/read-all
  async markAllAsRead(request, reply) {
    const result = await this.notificationService.markAllAsRead(request.user.id);
    return reply.send(successResponse(result));
  }
}

module.exports = NotificationController;