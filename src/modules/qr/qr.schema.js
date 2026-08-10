'use strict';

const { z } = require('zod');

const generateQRSchema = z.object({
  product_id: z.string().uuid('Invalid product ID'),
  buyer_id: z.string().uuid('Invalid buyer ID'),
});

const scanQRSchema = z.object({
  token: z.string().min(1, 'QR token is required'),
});

const cancelQRSchema = z.object({
  product_id: z.string().uuid('Invalid product ID'),
  reason: z.string().max(200).optional(),
});

const regenerateQRSchema = z.object({
  product_id: z.string().uuid('Invalid product ID'),
  buyer_id: z.string().uuid('Invalid buyer ID'),
});

module.exports = {
  generateQRSchema,
  scanQRSchema,
  cancelQRSchema,
  regenerateQRSchema,
};