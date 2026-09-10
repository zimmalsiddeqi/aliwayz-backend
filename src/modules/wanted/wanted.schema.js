'use strict';

const { z } = require('zod');

const createWantedRequestSchema = z.object({
  category: z.string().max(50).default('real_estate'),
  title: z.string().min(2, 'Title must be at least 2 characters').max(200).trim(),
  intent: z.string().max(50).default('buy'),
  item_type: z.string().max(100).trim().optional(),
  description: z.string().max(3000).trim().optional(),
  budget_min: z.coerce.number().min(0).default(0),
  budget_max: z.coerce.number().min(0).default(0),
  currency: z.string().length(3).default('USD'),
  location_city: z.string().max(150).trim().optional(),
  location_lat: z.coerce.number().min(-90).max(90).optional(),
  location_lng: z.coerce.number().min(-180).max(180).optional(),
  location_radius: z.coerce.number().int().min(1).max(500).default(10),
  preferred_areas: z.array(z.string()).optional().default([]),
  features: z.array(z.string()).optional().default([]),
  bedrooms: z.string().max(20).optional(),
  bathrooms: z.string().max(20).optional(),
  property_size: z.string().max(50).optional(),
  parking_important: z.boolean().optional().default(false),
  duration_days: z.coerce.number().int().min(1).max(365).default(30),
  metadata: z.record(z.any()).optional().default({}),
});

const updateWantedStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'fulfilled', 'cancelled']),
});

const submitMatchSchema = z.object({
  product_id: z.string().uuid().optional(),
  message: z.string().max(1000).trim().optional(),
});

module.exports = {
  createWantedRequestSchema,
  updateWantedStatusSchema,
  submitMatchSchema,
};
