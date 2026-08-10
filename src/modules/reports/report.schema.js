'use strict';

const { z } = require('zod');

const createReportSchema = z.object({
  target_type: z.enum(['user', 'product', 'store']),
  target_id: z.string().uuid('Invalid target ID'),
  reason: z.enum([
    'spam',
    'counterfeit',
    'inappropriate',
    'scam',
    'harassment',
    'other',
  ]),
  description: z.string().max(500).trim().optional(),
});

const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolution_note: z.string().max(500).trim().optional(),
});

module.exports = { createReportSchema, resolveReportSchema };