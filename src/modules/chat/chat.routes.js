'use strict';

const ChatController = require('./chat.controller');
const { authenticate } = require('../../middleware/authenticate');
const { sanitizeInput } = require('../../middleware/sanitize');

async function chatRoutes(fastify) {
  const ctrl = new ChatController(fastify);

  // All chat routes require authentication
  // Guests cannot message

  // POST /conversations
  fastify.post('/', {
    config: { rateLimit: { max: 30, timeWindow: '1m' } },
    preHandler: [authenticate, sanitizeInput],
    handler: ctrl.createConversation.bind(ctrl),
  });

  // GET /conversations
  fastify.get('/', {
    preHandler: [authenticate],
    handler: ctrl.getConversations.bind(ctrl),
  });

  // GET /conversations/:id
  fastify.get('/:id', {
    preHandler: [authenticate],
    handler: ctrl.getConversation.bind(ctrl),
  });

  // GET /conversations/:id/messages
  fastify.get('/:id/messages', {
    preHandler: [authenticate],
    handler: ctrl.getMessages.bind(ctrl),
  });

  // DELETE /conversations/:id
  fastify.delete('/:id', {
    preHandler: [authenticate],
    handler: ctrl.archiveConversation.bind(ctrl),
  });

  // POST /conversations/:id/block
  fastify.post('/:id/block', {
    preHandler: [authenticate],
    handler: ctrl.blockUser.bind(ctrl),
  });

  // POST /conversations/:id/report
  fastify.post('/:id/report', {
    config: { rateLimit: { max: 10, timeWindow: '15m' } },
    preHandler: [authenticate, sanitizeInput],
    handler: ctrl.reportConversation.bind(ctrl),
  });
}

module.exports = chatRoutes;