'use strict';

const UserService = require('./user.service');
const NotificationService = require('../notifications/notification.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');

const {
  updateProfileSchema,
  updateLocationSchema,
  updateRoleSchema,
  updateFcmTokenSchema,
} = require('./user.schema');

class UserController {
  constructor(fastify) {
    this.fastify = fastify;
    this.userService = new UserService(fastify.supabase, fastify.redis);
    this.notificationService = new NotificationService(
      fastify.supabase,
      fastify.redis
    );
  }

  _validate(schema, data) {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      throw new ValidationError('Validation failed', errors);
    }
    return result.data;
  }

  // GET /users/me
  async getMyProfile(request, reply) {
    const profile = await this.userService.getMyProfile(request.user.id);
    return reply.send(successResponse(profile));
  }

  // PUT /users/me
  async updateProfile(request, reply) {
    const data = this._validate(updateProfileSchema, request.body);
    const updated = await this.userService.updateProfile(request.user.id, data);
    return reply.send(successResponse(updated, 'Profile updated'));
  }

  // PUT /users/me/avatar
  async uploadAvatar(request, reply) {
    const file = await request.file();

    if (!file) {
      throw new ValidationError('No file provided');
    }

    const chunks = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const result = await this.userService.uploadAvatar(
      request.user.id,
      buffer,
      file.mimetype,
      request.user.username
    );

    return reply.send(successResponse(result, 'Avatar uploaded successfully'));
  }

  // PUT /users/me/location
  async updateLocation(request, reply) {
    const data = this._validate(updateLocationSchema, request.body);
    const result = await this.userService.updateLocation(request.user.id, data);
    return reply.send(successResponse(result));
  }

  // PUT /users/me/role
  async updateRole(request, reply) {
    const data = this._validate(updateRoleSchema, request.body);
    const result = await this.userService.updateRole(request.user.id, data.role);
    return reply.send(successResponse(result, 'Role updated successfully'));
  }

  // PUT /users/me/fcm-token
  async updateFcmToken(request, reply) {
    const data = this._validate(updateFcmTokenSchema, request.body);
    const result = await this.userService.updateFcmToken(
      request.user.id,
      data.fcm_token
    );
    return reply.send(successResponse(result));
  }

  // GET /users/:username
  async getPublicProfile(request, reply) {
    const { username } = request.params;
    const profile = await this.userService.getPublicProfile(username);
    return reply.send(successResponse(profile));
  }

  // GET /users/me/purchases
  async getPurchaseHistory(request, reply) {
    const result = await this.userService.getPurchaseHistory(
      request.user.id,
      request.query
    );
    return reply.send(
      paginatedResponse(result.data, result.pagination)
    );
  }

  // GET /users/me/favorites
  async getFavoriteProducts(request, reply) {
    const result = await this.userService.getFavoriteProducts(
      request.user.id,
      request.query
    );
    return reply.send(
      paginatedResponse(result.data, result.pagination)
    );
  }

  // GET /users/me/following
  async getFollowingStores(request, reply) {
    const result = await this.userService.getFollowingStores(
      request.user.id,
      request.query
    );
    return reply.send(
      paginatedResponse(result.data, result.pagination)
    );
  }

  // GET /users/me/notifications
  async getNotifications(request, reply) {
    const result = await this.notificationService.getUserNotifications(
      request.user.id,
      request.query
    );
    return reply.send(
      paginatedResponse(result.data, result.pagination)
    );
  }

  // PUT /users/me/notifications/:id
  async markNotificationRead(request, reply) {
    const { id } = request.params;
    const result = await this.notificationService.markAsRead(
      request.user.id,
      id
    );
    return reply.send(successResponse(result));
  }

  // PUT /users/me/notifications/read-all
  async markAllNotificationsRead(request, reply) {
    const result = await this.notificationService.markAllAsRead(request.user.id);
    return reply.send(successResponse(result));
  }

  // DELETE /users/me
  async deleteAccount(request, reply) {
    await this.userService.deleteAccount(request.user.id, request.user.username);
    return reply.send(successResponse(null, 'Account deleted successfully'));
  }
}

module.exports = UserController;