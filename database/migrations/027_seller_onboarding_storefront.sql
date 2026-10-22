-- Migration 027: Sell on Aliwayz Onboarding & Storefront Metadata
-- Adds backward-compatible seller identity and storefront columns to stores and products

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS seller_type VARCHAR(20) DEFAULT 'quick',
  ADD COLUMN IF NOT EXISTS business_type VARCHAR(60),
  ADD COLUMN IF NOT EXISTS has_storefront BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS street_address VARCHAR(255),
  ADD COLUMN IF NOT EXISTS address_visibility VARCHAR(20) DEFAULT 'approximate',
  ADD COLUMN IF NOT EXISTS business_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS business_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS website_url VARCHAR(255),
  ADD COLUMN IF NOT EXISTS business_hours JSONB;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS seller_identity VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_stores_seller_type ON public.stores(seller_type);
CREATE INDEX IF NOT EXISTS idx_products_seller_identity ON public.products(seller_identity);
