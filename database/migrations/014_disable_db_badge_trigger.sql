-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 014: DISABLE AUTOMATIC DATABASE BADGE TRIGGER
-- ═══════════════════════════════════════════════════════════════════

-- Drop the database-level auto-evaluation trigger on seller_stats.
-- This enforces the JavaScript badge engine as the single source of truth,
-- avoiding redundant database updates, double badge history audit logs,
-- and race conditions.
DROP TRIGGER IF EXISTS trg_badge_evaluation ON seller_stats;
