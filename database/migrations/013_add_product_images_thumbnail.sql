-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 013: ADD PRODUCT IMAGES THUMBNAIL COLUMNS
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE product_images
    ADD COLUMN IF NOT EXISTS thumbnail_storage_url TEXT,
    ADD COLUMN IF NOT EXISTS thumbnail_cdn_url TEXT;
