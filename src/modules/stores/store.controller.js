"use strict";

const StoreService = require("./store.service");
const {
  successResponse,
  paginatedResponse,
} = require("../../shared/utils/responseFormatter");
const ValidationError = require("../../shared/errors/ValidationError");
const { createStoreSchema, updateStoreSchema } = require("./store.schema");

class StoreController {
  constructor(fastify) {
    this.fastify = fastify;
    this.storeService = new StoreService(fastify.supabase, fastify.redis);
  }

  _validate(schema, data) {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      throw new ValidationError("Validation failed", errors);
    }
    return result.data;
  }

  // POST /stores
  async createStore(request, reply) {
    const data = this._validate(createStoreSchema, request.body);
    const store = await this.storeService.createStore(
      request.user.id,
      request.user.role,
      data,
    );
    return reply
      .status(201)
      .send(successResponse(store, "Store created successfully"));
  }

  // GET /stores/my
  async getMyStore(request, reply) {
    const store = await this.storeService.getMyStore(request.user.id);
    return reply.send(successResponse(store));
  }

  // GET /stores/:slug
  async getStore(request, reply) {
    const store = await this.storeService.getStoreBySlug(request.params.slug);
    return reply.send(successResponse(store));
  }

  // PUT /stores/:id
  async updateStore(request, reply) {
    const data = this._validate(updateStoreSchema, request.body);
    const updated = await this.storeService.updateStore(
      request.user.id,
      request.params.id,
      data,
    );
    return reply.send(successResponse(updated, "Store updated"));
  }

  // PUT /stores/:id/logo
async uploadLogo(request, reply) {
  // ✅ request.file() gets the first file from multipart
  const data = await request.file();

  if (!data) throw new ValidationError('No file provided');

  const chunks = [];
  for await (const chunk of data.file) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  const result = await this.storeService.uploadLogo(
    request.user.id,
    request.params.id,
    buffer,
    data.mimetype
  );
  return reply.send(successResponse(result, 'Logo uploaded'));
}

// PUT /stores/:id/banner
async uploadBanner(request, reply) {
  const data = await request.file();

  if (!data) throw new ValidationError('No file provided');

  const chunks = [];
  for await (const chunk of data.file) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  const result = await this.storeService.uploadBanner(
    request.user.id,
    request.params.id,
    buffer,
    data.mimetype
  );
  return reply.send(successResponse(result, 'Banner uploaded'));
}
  // GET /stores/:slug/products
  async getStoreProducts(request, reply) {
    const result = await this.storeService.getStoreProducts(
      request.params.slug,
      request.query,
      request.user?.id,
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /stores/:id/analytics
  async getStoreAnalytics(request, reply) {
    const result = await this.storeService.getStoreAnalytics(
      request.user.id,
      request.params.id,
    );
    return reply.send(successResponse(result));
  }

  // POST /stores/:slug/follow
  async followStore(request, reply) {
    const result = await this.storeService.followStore(
      request.user.id,
      request.params.slug,
    );
    return reply.send(successResponse(result));
  }

  // DELETE /stores/:slug/follow
  async unfollowStore(request, reply) {
    const result = await this.storeService.unfollowStore(
      request.user.id,
      request.params.slug,
    );
    return reply.send(successResponse(result));
  }

  // GET /stores/:id/followers
  async getStoreFollowers(request, reply) {
    const result = await this.storeService.getStoreFollowers(
      request.params.id,
      request.query,
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // DELETE /stores/:id
  async deleteStore(request, reply) {
    const result = await this.storeService.deleteStore(
      request.user.id,
      request.params.id,
    );
    return reply.send(successResponse(result));
  }
}

module.exports = StoreController;
