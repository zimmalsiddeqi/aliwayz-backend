'use strict';

const FavoriteController = require('./favorite.controller');
const { authenticate, optionalAuthenticate } = require('../../middleware/authenticate');

async function favoriteRoutes(fastify) {
  const ctrl = new FavoriteController(fastify);

  // POST /favorites/:productId — add to favorites
  fastify.post('/:productId', {
    config: { rateLimit: { max: 60, timeWindow: '1m' } },
    preHandler: [authenticate],
    handler: ctrl.addFavorite.bind(ctrl),
  });

  // DELETE /favorites/:productId — remove from favorites
  fastify.delete('/:productId', {
    preHandler: [authenticate],
    handler: ctrl.removeFavorite.bind(ctrl),
  });

  // GET /favorites — get own favorites list
  fastify.get('/', {
    preHandler: [authenticate],
    handler: ctrl.getUserFavorites.bind(ctrl),
  });

  // GET /favorites/:productId/status — check favorite status
  fastify.get('/:productId/status', {
    preHandler: [optionalAuthenticate],
    handler: async (request, reply) => {
      if (!request.user) {
        return reply.send({
          success: true,
          data: { is_favorited: false, favorite_count: null },
        });
      }
      return ctrl.getFavoriteStatus(request, reply);
    },
  });
}

module.exports = favoriteRoutes;