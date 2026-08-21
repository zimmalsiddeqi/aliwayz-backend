-- ─────────────────────────────────────────
-- MIGRATION: 020_fix_seller_verification_rls.sql
-- Fix RLS policies on seller_verifications, store_drafts, and audit logs
-- ─────────────────────────────────────────

-- 1. Fix seller_verifications RLS policies
ALTER TABLE seller_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_verification ON seller_verifications;
DROP POLICY IF EXISTS insert_own_verification ON seller_verifications;
DROP POLICY IF EXISTS update_verification ON seller_verifications;

CREATE POLICY select_own_verification ON seller_verifications
    FOR SELECT USING (
        auth.role() = 'service_role' OR
        auth.uid() = user_id OR
        user_id IN (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

CREATE POLICY insert_own_verification ON seller_verifications
    FOR INSERT WITH CHECK (
        auth.role() = 'service_role' OR
        auth.uid() = user_id OR
        user_id IN (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

CREATE POLICY update_verification ON seller_verifications
    FOR UPDATE USING (
        auth.role() = 'service_role' OR
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin') OR
        EXISTS (SELECT 1 FROM users WHERE users.supabase_uid = auth.uid() AND users.role = 'admin')
    );

-- 2. Fix seller_verification_audit_logs RLS policies
ALTER TABLE seller_verification_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select_logs ON seller_verification_audit_logs;
DROP POLICY IF EXISTS admin_insert_logs ON seller_verification_audit_logs;

CREATE POLICY admin_select_logs ON seller_verification_audit_logs
    FOR SELECT USING (
        auth.role() = 'service_role' OR
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin') OR
        EXISTS (SELECT 1 FROM users WHERE users.supabase_uid = auth.uid() AND users.role = 'admin')
    );

CREATE POLICY admin_insert_logs ON seller_verification_audit_logs
    FOR INSERT WITH CHECK (
        auth.role() = 'service_role' OR
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin') OR
        EXISTS (SELECT 1 FROM users WHERE users.supabase_uid = auth.uid() AND users.role = 'admin')
    );

-- 3. Fix store_drafts RLS policies
ALTER TABLE store_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_own_draft ON store_drafts;

CREATE POLICY access_own_draft ON store_drafts
    FOR ALL USING (
        auth.role() = 'service_role' OR
        auth.uid() = user_id OR
        user_id IN (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );
