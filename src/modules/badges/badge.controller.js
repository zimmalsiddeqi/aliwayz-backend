'use strict';

const BadgeService = require('./badge.service');
const { successResponse } = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');
const ForbiddenError = require('../../shared/errors/ForbiddenError');
const { z } = require('zod');

const triggerEvaluationSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
});

class BadgeController {
  constructor(fastify) {
    this.fastify = fastify;
    this.badgeService = new BadgeService(fastify.supabase, fastify.redis);
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

  // GET /badges
  async getAllBadges(request, reply) {
    const badges = await this.badgeService.getAllBadges();
    return reply.send(successResponse(badges));
  }

  // GET /badges/user/:userId
  async getUserBadges(request, reply) {
    const badges = await this.badgeService.getUserBadges(
      request.params.userId
    );
    return reply.send(successResponse(badges));
  }

  // GET /badges/history/:userId
  async getUserBadgeHistory(request, reply) {
    // Users can only view own history; admins can view any
    const targetId =
      request.user.role === 'admin'
        ? request.params.userId
        : request.user.id;

    if (
      request.params.userId !== request.user.id &&
      request.user.role !== 'admin'
    ) {
      throw new ForbiddenError('You can only view your own badge history');
    }

    const history = await this.badgeService.getUserBadgeHistory(targetId);
    return reply.send(successResponse(history));
  }

  // GET /badges/me/progress
  async getMyBadgeProgress(request, reply) {
    const progress = await this.badgeService.getBadgeProgress(request.user.id);
    return reply.send(successResponse(progress));
  }

  // POST /badges/evaluate/:userId — admin only
  async triggerEvaluation(request, reply) {
    const result = await this.badgeService.triggerEvaluation(
      request.params.userId
    );
    return reply.send(
      successResponse(result, 'Badge evaluation completed')
    );
  }
}

module.exports = BadgeController;