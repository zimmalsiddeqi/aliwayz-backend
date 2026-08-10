'use strict';

const { z } = require('zod');

const createConversationSchema = z.object({
  product_id: z.string().uuid('Invalid product ID'),
  initial_message: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message too long')
    .trim(),
    // ✅ NO .default() here
});

const sendMessageSchema = z.object({
  content: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message too long')
    .trim(),
});

const reportConversationSchema = z.object({
  reason: z.enum([
    'spam',
    'harassment',
    'scam',
    'inappropriate',
    'other',
  ]),
  description: z.string().max(500).optional(),
});

module.exports = {
  createConversationSchema,
  sendMessageSchema,
  reportConversationSchema,
};