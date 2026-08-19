-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 015: AUTOMATIC PRUNING OF POLYMORPHIC REPORT ORPHANS
-- ═══════════════════════════════════════════════════════════════════

-- Create a shared database function to delete report history 
-- associated with any deleted target (user, product, or store).
CREATE OR REPLACE FUNCTION prune_orphaned_reports()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM reports WHERE target_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger for users table hard-deletes
DROP TRIGGER IF EXISTS trg_prune_reports_users ON users;
CREATE TRIGGER trg_prune_reports_users
    BEFORE DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION prune_orphaned_reports();

-- Trigger for products table hard-deletes
DROP TRIGGER IF EXISTS trg_prune_reports_products ON products;
CREATE TRIGGER trg_prune_reports_products
    BEFORE DELETE ON products
    FOR EACH ROW
    EXECUTE FUNCTION prune_orphaned_reports();

-- Trigger for stores table hard-deletes
DROP TRIGGER IF EXISTS trg_prune_reports_stores ON stores;
CREATE TRIGGER trg_prune_reports_stores
    BEFORE DELETE ON stores
    FOR EACH ROW
    EXECUTE FUNCTION prune_orphaned_reports();
