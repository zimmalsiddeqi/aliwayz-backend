'use strict';

const QRController = require('./qr.controller');
const { authenticate } = require('../../middleware/authenticate');
const { requireSeller, requireBuyer } = require('../../middleware/authorize');
const { sanitizeInput } = require('../../middleware/sanitize');

async function qrRoutes(fastify) {
  const ctrl = new QRController(fastify);

  // POST /qr/generate — seller only
  fastify.post('/generate', {
    config: { rateLimit: { max: 20, timeWindow: '15m' } },
    preHandler: [authenticate, requireSeller, sanitizeInput],
    handler: ctrl.generateQR.bind(ctrl),
  });

  // POST /qr/scan — buyer only
  fastify.post('/scan', {
    config: { rateLimit: { max: 20, timeWindow: '15m' } },
    preHandler: [authenticate, sanitizeInput],
    handler: ctrl.scanQR.bind(ctrl),
  });

  // POST /qr/cancel — seller only
  fastify.post('/cancel', {
    preHandler: [authenticate, requireSeller, sanitizeInput],
    handler: ctrl.cancelQR.bind(ctrl),
  });

  // POST /qr/regenerate — seller only
  fastify.post('/regenerate', {
    config: { rateLimit: { max: 10, timeWindow: '15m' } },
    preHandler: [authenticate, requireSeller, sanitizeInput],
    handler: ctrl.regenerateQR.bind(ctrl),
  });

  // GET /qr/status/:productId — seller only
  fastify.get('/status/:productId', {
    preHandler: [authenticate, requireSeller],
    handler: ctrl.getActiveQRStatus.bind(ctrl),
  });
}

module.exports = qrRoutes;