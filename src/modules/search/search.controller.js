'use strict';

const SearchService = require('./search.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');

const {
  searchQuerySchema,
  storeSearchSchema,
  suggestionSchema,
} = require('./search.schema');

class SearchController {
  constructor(fastify) {
    this.fastify = fastify;
    this.searchService = new SearchService(fastify.supabase, fastify.redis);
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

  // GET /search?q=&category=&...
  async searchProducts(request, reply) {
    const query = this._validate(searchQuerySchema, request.query);
    const result = await this.searchService.searchProducts(
      query,
      request.user?.id || null
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /search/stores?q=
  async searchStores(request, reply) {
    const query = this._validate(storeSearchSchema, request.query);
    const result = await this.searchService.searchStores(query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /search/suggestions?q=
  async getSuggestions(request, reply) {
    const query = this._validate(suggestionSchema, request.query);
    const suggestions = await this.searchService.getSuggestions(query.q);
    return reply.send(successResponse(suggestions));
  }

  // GET /search/popular
  async getPopularSearches(request, reply) {
    const popular = await this.searchService.getPopularSearches(10);
    return reply.send(successResponse(popular));
  }

  // GET /search/history
  async getSearchHistory(request, reply) {
    const history = await this.searchService.getUserSearchHistory(
      request.user.id
    );
    return reply.send(successResponse(history));
  }

  // DELETE /search/history
  async clearSearchHistory(request, reply) {
    const result = await this.searchService.clearSearchHistory(request.user.id);
    return reply.send(successResponse(result));
  }
}

module.exports = SearchController;