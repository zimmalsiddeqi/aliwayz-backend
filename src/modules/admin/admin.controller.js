'use strict';

const AdminService = require('./admin.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');

const {
  updateUserStatusSchema,
  featureProductSchema,
  broadcastNotificationSchema,
  deleteProductSchema,
} = require('./admin.schema');
const { reviewVerificationSchema } = require('../verification/verification.schema');

class AdminController {
  constructor(fastify) {
    this.fastify = fastify;
    this.adminService = new AdminService(fastify.supabase, fastify.redis);
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

  // GET /admin/dashboard
  async getDashboard(request, reply) {
    const stats = await this.adminService.getDashboard();
    return reply.send(successResponse(stats));
  }

  // GET /admin/users
  async getAllUsers(request, reply) {
    const result = await this.adminService.getAllUsers(request.query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /admin/users/:id
  async getUserDetail(request, reply) {
    const user = await this.adminService.getUserDetail(request.params.id);
    return reply.send(successResponse(user));
  }

  // PUT /admin/users/:id/status
  async updateUserStatus(request, reply) {
    const data = this._validate(updateUserStatusSchema, request.body);
    const result = await this.adminService.updateUserStatus(
      request.user.id,
      request.params.id,
      data.status,
      data.reason
    );
    return reply.send(successResponse(result, `User ${data.status}`));
  }

  // DELETE /admin/users/:id
  async deleteUser(request, reply) {
    await this.adminService.deleteUser(request.user.id, request.params.id);
    return reply.send(successResponse(null, 'User deleted'));
  }

  // GET /admin/stores
  async getAllStores(request, reply) {
    const result = await this.adminService.getAllStores(request.query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // PUT /admin/stores/:id/verify
  async verifyStore(request, reply) {
    const isVerified = request.body.is_verified !== false;
    const result = await this.adminService.setStoreVerification(
      request.user.id,
      request.params.id,
      isVerified
    );
    return reply.send(
      successResponse(result, isVerified ? 'Store verified' : 'Store unverified')
    );
  }

  // GET /admin/products
  async getAllProducts(request, reply) {
    const result = await this.adminService.getAllProducts(request.query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // PUT /admin/products/:id/feature
  async featureProduct(request, reply) {
    const data = this._validate(featureProductSchema, request.body);
    const result = await this.adminService.setProductFeatured(
      request.user.id,
      request.params.id,
      data.is_featured,
      data.featured_until
    );
    return reply.send(successResponse(result));
  }

  // DELETE /admin/products/:id
  async deleteProduct(request, reply) {
    const data = this._validate(deleteProductSchema, request.body || {});
    await this.adminService.deleteProduct(
      request.user.id,
      request.params.id,
      data.reason
    );
    return reply.send(successResponse(null, 'Product deleted'));
  }

  // POST /admin/notifications/push
  async sendBroadcast(request, reply) {
    const data = this._validate(broadcastNotificationSchema, request.body);
    const result = await this.adminService.sendBroadcastNotification(
      request.user.id,
      data
    );
    return reply.send(
      successResponse(result, 'Broadcast notification sent')
    );
  }

  // GET /admin/logs
  async getAdminLogs(request, reply) {
    const result = await this.adminService.getAdminLogs(request.query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /admin/verifications
  async getPendingVerifications(request, reply) {
    const result = await this.adminService.getPendingVerifications(request.query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // PUT /admin/verifications/:id
  async reviewVerification(request, reply) {
    const data = this._validate(reviewVerificationSchema, request.body);
    const result = await this.adminService.reviewVerification(
      request.user.id,
      request.params.id,
      data.status,
      data.rejection_reason,
      request.ip,
      data.notes
    );
    return reply.send(successResponse(result, `Verification request ${data.status}`));
  }
}

module.exports = AdminController;