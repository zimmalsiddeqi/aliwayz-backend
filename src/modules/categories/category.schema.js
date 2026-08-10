'use strict';

const { z } = require('zod');

const createCategorySchema = z.object({
  name: z.string().min(2).max(100).trim(),
  parent_id: z.string().uuid('Invalid parent category ID').optional().nullable(),
  icon_url: z.string().url('Invalid icon URL').optional().nullable(),
  display_order: z.number().int().min(0).default(0),
});

const updateCategorySchema = createCategorySchema.partial();

const categoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor']).optional(),
  sort: z
    .enum(['newest', 'oldest', 'price_asc', 'price_desc', 'popular'])
    .default('newest'),
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  categoryQuerySchema,
};