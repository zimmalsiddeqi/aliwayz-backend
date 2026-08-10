-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 009: PATCH MISSING COLUMNS + REVIEW SERVICE FIX
-- Fixes:
--   1. notifications table missing updated_at (trigger already exists from 008)
--   2. reviews table product_id column (needed for service join)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add updated_at to notifications (trigger already installed by 008)
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Ensure reviews has product_id if not already present
--    (review.service.js joins on product_id)
ALTER TABLE reviews
    ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
