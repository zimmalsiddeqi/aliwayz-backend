'use strict';

const FavoriteService = require('./favorite.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');

class FavoriteController {
  constructor(fastify) {
    this.fastify = fastify;
    this.favoriteService = new FavoriteService(
      fastify.supabase,
      fastify.redis
    );
  }

  // POST /favorites/:productId
  async addFavorite(request, reply) {
    const result = await this.favoriteService.addFavorite(
      request.user.id,
      request.params.productId
    );
    return reply.status(201).send(successResponse(result, 'Added to favorites'));
  }

  // DELETE /favorites/:productId
  async removeFavorite(request, reply) {
    const result = await this.favoriteService.removeFavorite(
      request.user.id,
      request.params.productId
    );
    return reply.send(successResponse(result, 'Removed from favorites'));
  }

  // GET /favorites
  async getUserFavorites(request, reply) {
    const result = await this.favoriteService.getUserFavorites(
      request.user.id,
      request.query
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /favorites/:productId/status
  async getFavoriteStatus(request, reply) {
    const result = await this.favoriteService.checkFavoriteStatus(
      request.user.id,
      request.params.productId
    );
    return reply.send(successResponse(result));
  }
}

module.exports = FavoriteController;