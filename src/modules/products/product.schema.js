'use strict';

const { z } = require('zod');

const createProductSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200).trim(),
  description: z.string().max(5000).trim().optional(),
  category_id: z.string().uuid('Invalid category ID — get it from GET /categories'),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor'], {
    errorMap: () => ({
      message: 'Condition must be: new, like_new, good, fair, or poor',
    }),
  }),
  // Coerce handles string numbers from Postman
  price: z.coerce
    .number({ invalid_type_error: 'Price must be a number' })
    .positive('Price must be greater than 0')
    .max(999999999, 'Price too high'),
  currency: z.string().length(3).default('USD'),
  brand: z.string().max(100).trim().optional(),
  color: z.string().max(50).trim().optional(),
  quantity: z.coerce.number().int().min(1).max(9999).default(1),
  location_city: z.string().max(100).trim().optional(),
  location_lat: z.coerce.number().min(-90).max(90).optional(),
  location_lng: z.coerce.number().min(-180).max(180).optional(),
  status: z.enum(['available', 'draft']).default('available'),
});

const updateProductSchema = z.object({
  title: z.string().min(3).max(200).trim().optional(),
  description: z.string().max(5000).trim().optional(),
  category_id: z.string().uuid().optional(),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor']).optional(),
  price: z.coerce.number().positive().max(999999999).optional(),
  brand: z.string().max(100).trim().optional(),
  color: z.string().max(50).trim().optional(),
  quantity: z.coerce.number().int().min(1).max(9999).optional(),
  location_city: z.string().max(100).trim().optional(),
  location_lat: z.coerce.number().min(-90).max(90).optional(),
  location_lng: z.coerce.number().min(-180).max(180).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['available', 'reserved', 'hidden', 'draft'], {
    errorMap: () => ({
      message: 'Status must be: available, reserved, hidden, or draft',
    }),
  }),
});

module.exports = {
  createProductSchema,
  updateProductSchema,
  updateStatusSchema,
};