'use strict';

const { z } = require('zod');

const updateProfileSchema = z.object({
  full_name: z.string().min(2).max(100).trim().optional(),
  bio: z.string().max(500).trim().optional(),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores'
    )
    .toLowerCase()
    .trim()
    .optional(),
});

const updateLocationSchema = z.object({
  location_city: z.string().min(2).max(100).trim(),
  location_lat: z.number().min(-90).max(90),
  location_lng: z.number().min(-180).max(180),
});

const updateRoleSchema = z.object({
  role: z.enum(['buyer', 'seller', 'both']),
});

const updateFcmTokenSchema = z.object({
  fcm_token: z.string().min(1).max(500),
});

module.exports = {
  updateProfileSchema,
  updateLocationSchema,
  updateRoleSchema,
  updateFcmTokenSchema,
};