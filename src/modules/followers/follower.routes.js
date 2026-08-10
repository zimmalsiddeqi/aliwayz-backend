'use strict';

const FollowerController = require('./follower.controller');
const { authenticate, optionalAuthenticate } = require('../../middleware/authenticate');

async function followerRoutes(fastify) {
  const ctrl = new FollowerController(fastify);

  // POST /followers/stores/:storeId — follow a store
  fastify.post('/stores/:storeId', {
    config: { rateLimit: { max: 30, timeWindow: '1m' } },
    preHandler: [authenticate],
    handler: ctrl.followStore.bind(ctrl),
  });

  // DELETE /followers/stores/:storeId — unfollow a store
  fastify.delete('/stores/:storeId', {
    preHandler: [authenticate],
    handler: ctrl.unfollowStore.bind(ctrl),
  });

  // GET /followers/stores/:storeId — list store followers (public)
  fastify.get('/stores/:storeId', {
    handler: ctrl.getStoreFollowers.bind(ctrl),
  });

  // GET /followers/me/stores — stores current user follows
  fastify.get('/me/stores', {
    preHandler: [authenticate],
    handler: ctrl.getMyFollowedStores.bind(ctrl),
  });

  // GET /followers/stores/:storeId/status — check follow status
  fastify.get('/stores/:storeId/status', {
    preHandler: [optionalAuthenticate],
    handler: async (request, reply) => {
      if (!request.user) {
        return reply.send({
          success: true,
          data: { is_following: false, follower_count: null },
        });
      }
      return ctrl.getFollowStatus(request, reply);
    },
  });
}

module.exports = followerRoutes;