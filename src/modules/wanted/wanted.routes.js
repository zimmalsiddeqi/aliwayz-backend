'use strict';

const WantedController = require('./wanted.controller');
const { authenticate, optionalAuthenticate } = require('../../middleware/authenticate');

async function wantedRoutes(fastify) {
  const ctrl = new WantedController(fastify);

  // POST /wanted — Create a new wanted request (auth required)
  fastify.post('/', {
    preHandler: [authenticate],
    handler: ctrl.createWantedRequest.bind(ctrl),
  });

  // GET /wanted — Public feed / browsing
  fastify.get('/', {
    preHandler: [optionalAuthenticate],
    handler: ctrl.browseWantedRequests.bind(ctrl),
  });

  // GET /wanted/my — Current user requests (auth required)
  fastify.get('/my', {
    preHandler: [authenticate],
    handler: ctrl.getMyRequests.bind(ctrl),
  });

  // GET /wanted/:id — View request details
  fastify.get('/:id', {
    preHandler: [optionalAuthenticate],
    handler: ctrl.getRequestById.bind(ctrl),
  });

  // PATCH /wanted/:id/status — Update status (active, paused, fulfilled)
  fastify.patch('/:id/status', {
    preHandler: [authenticate],
    handler: ctrl.updateStatus.bind(ctrl),
  });

  // POST /wanted/:id/match — Submit a match ("I Have This")
  fastify.post('/:id/match', {
    preHandler: [authenticate],
    handler: ctrl.submitMatch.bind(ctrl),
  });
}

module.exports = wantedRoutes;
