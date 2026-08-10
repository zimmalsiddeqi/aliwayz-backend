'use strict';

const ReportService = require('./report.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');
const { createReportSchema, resolveReportSchema } = require('./report.schema');

class ReportController {
  constructor(fastify) {
    this.fastify = fastify;
    this.reportService = new ReportService(fastify.supabase, fastify.redis);
  }

  _validate(schema, data) {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      throw new ValidationError('Validation failed', errors);
    }
    return result.data;
  }

  // POST /reports
  async submitReport(request, reply) {
    const data = this._validate(createReportSchema, request.body);
    const report = await this.reportService.submitReport(request.user.id, data);
    return reply.status(201).send(successResponse(report, 'Report submitted'));
  }

  // GET /reports/me
  async getMyReports(request, reply) {
    const result = await this.reportService.getMyReports(
      request.user.id,
      request.query
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /reports — admin
  async getAllReports(request, reply) {
    const result = await this.reportService.getAllReports(request.query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // PUT /reports/:id — admin
  async resolveReport(request, reply) {
    const data = this._validate(resolveReportSchema, request.body);
    const result = await this.reportService.resolveReport(
      request.user.id,
      request.params.id,
      data.status,
      data.resolution_note
    );
    return reply.send(successResponse(result, 'Report resolved'));
  }
}

module.exports = ReportController;