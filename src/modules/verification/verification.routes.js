'use strict';

const VerificationController = require('./verification.controller');
const { authenticate } = require('../../middleware/authenticate');
const { requireSeller } = require('../../middleware/authorize');

async function verificationRoutes(fastify) {
  const ctrl = new VerificationController(fastify);

  // Bind routes
  const getStatus = ctrl.getStatus.bind(ctrl);
  const submitVerification = ctrl.submitVerification.bind(ctrl);

  // Status check
  fastify.get('/status', {
    preHandler: [authenticate],
    handler: getStatus,
  });

  // Submit documents (max 3 submissions per 24 hours)
  fastify.post('/submit', {
    config: { rateLimit: { max: 3, timeWindow: '24h' } },
    preHandler: [authenticate],
    handler: submitVerification,
  });
}

module.exports = verificationRoutes;
