'use strict';

const FavoriteController = require('./favorite.controller');
const { authenticate, optionalAuthenticate } = require('../../middleware/authenticate');

async function favoriteRoutes(fastify) {
  const ctrl = new FavoriteController(fastify);

  // GET /favorites/debug — debug database contents
  fastify.get('/debug', async (request, reply) => {
    const { data: favs, error: favsErr } = await fastify.supabase.from('favorites').select('*');
    const { data: users, error: usersErr } = await fastify.supabase.from('users').select('id, username').limit(5);
    return reply.send({
      supabaseUrl: process.env.SUPABASE_URL,
      favorites: { count: favs?.length, data: favs, error: favsErr },
      users: { count: users?.length, data: users, error: usersErr }
    });
  });

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