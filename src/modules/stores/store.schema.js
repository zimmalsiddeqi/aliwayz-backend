'use strict';

const { z } = require('zod');

const createStoreSchema = z.object({
  store_name: z.string().min(3).max(100).trim(),
  description: z.string().max(1000).trim().optional(),
  category_id: z.string().uuid('Invalid category ID').optional(),
  location_city: z.string().max(100).trim().optional(),
  location_lat: z.number().min(-90).max(90).optional(),
  location_lng: z.number().min(-180).max(180).optional(),
  social_instagram: z
    .string()
    .url('Invalid Instagram URL')
    .max(255)
    .optional()
    .or(z.literal('')),
  social_facebook: z
    .string()
    .url('Invalid Facebook URL')
    .max(255)
    .optional()
    .or(z.literal('')),
  social_tiktok: z
    .string()
    .url('Invalid TikTok URL')
    .max(255)
    .optional()
    .or(z.literal('')),
});

const updateStoreSchema = createStoreSchema.partial();

module.exports = { createStoreSchema, updateStoreSchema };