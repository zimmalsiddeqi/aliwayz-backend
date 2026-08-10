"use strict";
const logger = require('../../shared/utils/logger');
const ProductService = require("./product.service");
const {
  successResponse,
  paginatedResponse,
} = require("../../shared/utils/responseFormatter");
const ValidationError = require("../../shared/errors/ValidationError");
const AppError = require("../../shared/errors/AppError");
const { validateSchema } = require("../../shared/utils/validateSchema");

const {
  createProductSchema,
  updateProductSchema,
  updateStatusSchema,
} = require("./product.schema");

class ProductController {
  constructor(fastify) {
    this.fastify = fastify;
    this.productService = new ProductService(fastify.supabase, fastify.redis);
  }

  // ─────────────────────────────────────────
  // Safe Zod validation
  // ─────────────────────────────────────────
  _validate(schema, data) {
    return validateSchema(schema, data);
  }

  // ─────────────────────────────────────────
  // POST /products
  // ─────────────────────────────────────────
  async createProduct(request, reply) {
    const data = this._validate(createProductSchema, request.body);

    const { data: store, error: storeError } = await request.server.supabase
      .from("stores")
      .select("id")
      .eq("user_id", request.user.id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (storeError) {
      throw new AppError("Failed to fetch store information", 500);
    }

    if (!store) {
      throw new AppError(
        "You need to create a store before listing products. Go to Stores → Create Store first.",
        400,
        "NO_STORE",
      );
    }

    const product = await this.productService.createProduct(
      request.user.id,
      store.id,
      request.user.role,
      data,
    );

    return reply
      .status(201)
      .send(successResponse(product, "Product listed successfully"));
  }

  // ─────────────────────────────────────────
  // GET /products
  // ─────────────────────────────────────────
  async browseProducts(request, reply) {
    const result = await this.productService.browseProducts(request.query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // ─────────────────────────────────────────
  // GET /products/feed/trending
  // ─────────────────────────────────────────
  async getTrendingFeed(request, reply) {
    const data = await this.productService.getTrendingFeed();
    return reply.send(successResponse(data));
  }

  // ─────────────────────────────────────────
  // GET /products/feed/recent
  // ─────────────────────────────────────────
  async getRecentFeed(request, reply) {
    const result = await this.productService.getRecentFeed(request.query);
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // ─────────────────────────────────────────
  // GET /products/feed/nearby
  // ─────────────────────────────────────────
  async getNearbyFeed(request, reply) {
    const { lat, lng, radius_km } = request.query;

    if (!lat || !lng) {
      throw new AppError(
        "lat and lng query parameters are required for nearby feed",
        400,
        "LOCATION_REQUIRED",
      );
    }

    const data = await this.productService.getNearbyFeed(
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radius_km) || 50,
    );
    return reply.send(successResponse(data));
  }

  // ─────────────────────────────────────────
  // GET /products/feed/recommended
  // ─────────────────────────────────────────
  async getRecommendedFeed(request, reply) {
    const data = await this.productService.getRecommendedFeed(
      request.user?.id || null,
    );
    return reply.send(successResponse(data));
  }

  // ─────────────────────────────────────────
  // GET /products/:id
  // ─────────────────────────────────────────
  async getProduct(request, reply) {
    const product = await this.productService.getProduct(
      request.params.id,
      request.user?.id || null,
      request.ip,
    );
    return reply.send(successResponse(product));
  }

  // ─────────────────────────────────────────
  // PUT /products/:id
  // ─────────────────────────────────────────
  async updateProduct(request, reply) {
    const data = this._validate(updateProductSchema, request.body);
    const updated = await this.productService.updateProduct(
      request.user.id,
      request.params.id,
      data,
    );
    return reply.send(successResponse(updated, "Product updated"));
  }

  // ─────────────────────────────────────────
  // PUT /products/:id/status
  // ─────────────────────────────────────────
  async updateStatus(request, reply) {
    const data = this._validate(updateStatusSchema, request.body);
    const updated = await this.productService.updateProductStatus(
      request.user.id,
      request.params.id,
      data.status,
    );
    return reply.send(successResponse(updated, "Status updated"));
  }

  // ─────────────────────────────────────────
  // DELETE /products/:id
  // ─────────────────────────────────────────
  async deleteProduct(request, reply) {
    const result = await this.productService.deleteProduct(
      request.user.id,
      request.params.id,
    );
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // POST /products/:id/images
  // ─────────────────────────────────────────
// POST /products/:id/images
async uploadImages(request, reply) {
  const files = [];

  try {
    // ✅ FIX: Use request.parts() which handles mixed multipart
    // request.files() only works for specific configurations
    const parts = request.parts();

    for await (const part of parts) {
      // Only process file parts (skip text fields)
      if (part.file) {
        const chunks = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }

        if (chunks.length > 0) {
          files.push({
            buffer:   Buffer.concat(chunks),
            mimetype: part.mimetype,
            filename: part.filename,
          });
        }
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to process multipart upload');
    throw new AppError('Failed to process uploaded files', 400);
  }

  if (files.length === 0) {
    throw new ValidationError('No images provided');
  }

  const images = await this.productService.uploadProductImages(
    request.user.id,
    request.params.id,
    files
  );

  return reply
    .status(201)
    .send(
      successResponse(
        images,
        `${images.length} image(s) uploaded successfully`
      )
    );
}

  // ─────────────────────────────────────────
  // DELETE /products/:id/images/:imageId
  // ─────────────────────────────────────────
  async deleteImage(request, reply) {
    const result = await this.productService.deleteProductImage(
      request.user.id,
      request.params.id,
      request.params.imageId,
    );
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // POST /products/:id/video
  // ─────────────────────────────────────────
  async uploadVideo(request, reply) {
    const file = await request.file();
    if (!file) throw new ValidationError("No video provided");

    const chunks = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const video = await this.productService.uploadProductVideo(
      request.user.id,
      request.params.id,
      buffer,
      file.mimetype,
    );

    return reply
      .status(201)
      .send(successResponse(video, "Video uploaded successfully"));
  }

  // ─────────────────────────────────────────
  // POST /products/:id/favorite
  // ─────────────────────────────────────────
  async favoriteProduct(request, reply) {
    const result = await this.productService.favoriteProduct(
      request.user.id,
      request.params.id,
    );
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // DELETE /products/:id/favorite
  // ─────────────────────────────────────────
  async unfavoriteProduct(request, reply) {
    const result = await this.productService.unfavoriteProduct(
      request.user.id,
      request.params.id,
    );
    return reply.send(successResponse(result));
  }
}

module.exports = ProductController;
