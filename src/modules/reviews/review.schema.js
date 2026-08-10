'use strict';

const { z } = require('zod');

const createReviewSchema = z.object({
  qr_transaction_id: z.string().uuid('Invalid transaction ID'),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).trim().optional(),
  // Buyer reviewing seller tags
  tag_friendly: z.boolean().default(false),
  tag_fast: z.boolean().default(false),
  tag_accurate: z.boolean().default(false),
  tag_great_comm: z.boolean().default(false),
  tag_would_buy_again: z.boolean().default(false),
  // Seller reviewing buyer tags
  tag_would_sell_again: z.boolean().default(false),
});

module.exports = { createReviewSchema };