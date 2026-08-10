'use strict';

const { z } = require('zod');

const updateUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'banned']),
  reason: z.string().max(500).optional(),
});

const featureProductSchema = z.object({
  is_featured: z.boolean(),
  featured_until: z.string().datetime().optional().nullable(),
});

const broadcastNotificationSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  user_ids: z.array(z.string().uuid()).optional(),
});

const deleteProductSchema = z.object({
  reason: z.string().max(500).optional(),
});

module.exports = {
  updateUserStatusSchema,
  featureProductSchema,
  broadcastNotificationSchema,
  deleteProductSchema,
};