'use strict';

const CategoryService = require('./category.service');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');
const { z } = require('zod');

const createCategorySchema = z.object({
  name: z.string().min(2).max(100).trim(),
  parent_id: z.string().uuid().optional().nullable(),
  icon_url: z.string().url().optional().nullable(),
  display_order: z.number().int().min(0).default(0),
});

const updateCategorySchema = createCategorySchema.partial();

class CategoryController {
  constructor(fastify) {
    this.fastify = fastify;
    this.categoryService = new CategoryService(fastify.supabase, fastify.redis);
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

  // GET /categories
  async getCategoryTree(request, reply) {
    const tree = await this.categoryService.getCategoryTree();
    return reply.send(successResponse(tree));
  }

  // GET /categories/flat
  async getAllCategoriesFlat(request, reply) {
    const categories = await this.categoryService.getAllCategoriesFlat();
    return reply.send(successResponse(categories));
  }

  // GET /categories/:slug
  async getCategoryWithProducts(request, reply) {
    const result = await this.categoryService.getCategoryWithProducts(
      request.params.slug,
      request.query
    );
    return reply.send({
      success: true,
      data: {
        category: result.category,
        products: result.products,
      },
      pagination: result.pagination,
    });
  }

  // POST /categories (admin)
  async createCategory(request, reply) {
    const data = this._validate(createCategorySchema, request.body);
    const category = await this.categoryService.createCategory(data);
    return reply
      .status(201)
      .send(successResponse(category, 'Category created successfully'));
  }

  // PUT /categories/:id (admin)
  async updateCategory(request, reply) {
    const data = this._validate(updateCategorySchema, request.body);
    const category = await this.categoryService.updateCategory(
      request.params.id,
      data
    );
    return reply.send(successResponse(category, 'Category updated successfully'));
  }

  // DELETE /categories/:id (admin)
  async deleteCategory(request, reply) {
    const result = await this.categoryService.deleteCategory(request.params.id);
    return reply.send(successResponse(result));
  }
}

module.exports = CategoryController;