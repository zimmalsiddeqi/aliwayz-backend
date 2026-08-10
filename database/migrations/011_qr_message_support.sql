-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 011: Add qr_code content type to messages
-- ═══════════════════════════════════════════════════════════════

-- Update the content_type check constraint to include qr_code
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN ('text', 'system', 'qr_code'));