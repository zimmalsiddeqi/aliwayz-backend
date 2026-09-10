'use strict';

const logger = require('../../shared/utils/logger');
const WantedService = require('./wanted.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');
const { validateSchema } = require('../../shared/utils/validateSchema');
const {
  createWantedRequestSchema,
  updateWantedStatusSchema,
  submitMatchSchema,
} = require('./wanted.schema');

class WantedController {
  constructor(fastify) {
    this.fastify = fastify;
    this.wantedService = new WantedService(fastify.supabase, fastify.redis);
  }

  _validate(schema, data) {
    return validateSchema(schema, data);
  }

  async createWantedRequest(request, reply) {
    const data = this._validate(createWantedRequestSchema, request.body);
    const result = await this.wantedService.createRequest(request.user.id, data);
    return reply.status(201).send(successResponse(result, 'Wanted request posted successfully'));
  }

  async browseWantedRequests(request, reply) {
    const result = await this.wantedService.browseRequests(request.query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  async getMyRequests(request, reply) {
    const { status } = request.query;
    const result = await this.wantedService.getMyRequests(request.user.id, status);
    return reply.send(successResponse(result));
  }

  async getRequestById(request, reply) {
    const { id } = request.params;
    const result = await this.wantedService.getRequestById(id);
    return reply.send(successResponse(result));
  }

  async updateStatus(request, reply) {
    const { id } = request.params;
    const data = this._validate(updateWantedStatusSchema, request.body);
    const result = await this.wantedService.updateStatus(id, request.user.id, data.status);
    return reply.send(successResponse(result, 'Request status updated'));
  }

  async submitMatch(request, reply) {
    const { id } = request.params;
    const data = this._validate(submitMatchSchema, request.body);
    const result = await this.wantedService.submitMatch(request.user.id, id, data);
    return reply.status(201).send(successResponse(result, 'Match submitted successfully'));
  }
}

module.exports = WantedController;
