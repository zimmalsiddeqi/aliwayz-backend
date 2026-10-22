'use strict';

const { z } = require('zod');

const createStoreSchema = z.object({
  store_name: z.string().min(3).max(100).trim(),
  description: z.string().max(1000).trim().optional().nullable(),
  category_id: z.string().uuid('Invalid category ID').optional().nullable(),
  location_city: z.string().max(100).trim().optional().nullable(),
  location_lat: z.number().min(-90).max(90).optional().nullable(),
  location_lng: z.number().min(-180).max(180).optional().nullable(),
  social_instagram: z.string().max(255).trim().optional().nullable().or(z.literal('')),
  social_facebook: z.string().max(255).trim().optional().nullable().or(z.literal('')),
  social_tiktok: z.string().max(255).trim().optional().nullable().or(z.literal('')),
});

const updateStoreSchema = createStoreSchema.partial();

module.exports = { createStoreSchema, updateStoreSchema };
