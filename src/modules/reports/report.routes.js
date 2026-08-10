'use strict';

const ReportController = require('./report.controller');
const { authenticate } = require('../../middleware/authenticate');
const { requireAdmin } = require('../../middleware/authorize');
const { sanitizeInput } = require('../../middleware/sanitize');

async function reportRoutes(fastify) {
  const ctrl = new ReportController(fastify);

  // POST /reports — any authenticated user
  fastify.post('/', {
    config: { rateLimit: { max: 10, timeWindow: '1h' } },
    preHandler: [authenticate, sanitizeInput],
    handler: ctrl.submitReport.bind(ctrl),
  });

  // GET /reports/me — own submitted reports
  fastify.get('/me', {
    preHandler: [authenticate],
    handler: ctrl.getMyReports.bind(ctrl),
  });

  // GET /reports — admin only
  fastify.get('/', {
    preHandler: [authenticate, requireAdmin],
    handler: ctrl.getAllReports.bind(ctrl),
  });

  // PUT /reports/:id — admin only
  fastify.put('/:id', {
    preHandler: [authenticate, requireAdmin, sanitizeInput],
    handler: ctrl.resolveReport.bind(ctrl),
  });
}

module.exports = reportRoutes;