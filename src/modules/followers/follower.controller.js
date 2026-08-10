'use strict';

const FollowerService = require('./follower.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');

class FollowerController {
  constructor(fastify) {
    this.fastify = fastify;
    this.followerService = new FollowerService(
      fastify.supabase,
      fastify.redis
    );
  }

  // POST /followers/stores/:storeId
  async followStore(request, reply) {
    const result = await this.followerService.followStore(
      request.user.id,
      request.params.storeId
    );
    return reply.status(201).send(successResponse(result, 'Store followed'));
  }

  // DELETE /followers/stores/:storeId
  async unfollowStore(request, reply) {
    const result = await this.followerService.unfollowStore(
      request.user.id,
      request.params.storeId
    );
    return reply.send(successResponse(result, 'Store unfollowed'));
  }

  // GET /followers/stores/:storeId
  async getStoreFollowers(request, reply) {
    const result = await this.followerService.getStoreFollowers(
      request.params.storeId,
      request.query
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /followers/me/stores
  async getMyFollowedStores(request, reply) {
    const result = await this.followerService.getUserFollowedStores(
      request.user.id,
      request.query
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /followers/stores/:storeId/status
  async getFollowStatus(request, reply) {
    const result = await this.followerService.checkFollowStatus(
      request.user.id,
      request.params.storeId
    );
    return reply.send(successResponse(result));
  }
}

module.exports = FollowerController;