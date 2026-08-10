'use strict';

const { z } = require('zod');

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200).trim(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  category_id: z.string().uuid().optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor']).optional(),
  sort: z
    .enum(['relevance', 'newest', 'price_asc', 'price_desc', 'popular'])
    .default('relevance'),
  city: z.string().max(100).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().min(1).max(500).default(50),
  verified_sellers: z.coerce.boolean().optional(),
  min_seller_rating: z.coerce.number().min(0).max(5).optional(),
});

const storeSearchSchema = z.object({
  q: z.string().min(1).max(200).trim(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const suggestionSchema = z.object({
  q: z.string().min(1).max(100).trim(),
});

module.exports = {
  searchQuerySchema,
  storeSearchSchema,
  suggestionSchema,
};