-- Migration: 026_legal_consents.sql
-- Description: Creates the legal_consents table for tracking immutable user acceptance of Terms of Use and Privacy Policy versions.

CREATE TABLE IF NOT EXISTS legal_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    terms_version VARCHAR(30) NOT NULL,
    privacy_version VARCHAR(30) NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    source VARCHAR(50) NOT NULL DEFAULT 'signup',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexing for fast lookups
CREATE INDEX IF NOT EXISTS idx_legal_consents_user_id ON legal_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_legal_consents_user_versions ON legal_consents(user_id, terms_version, privacy_version);
CREATE INDEX IF NOT EXISTS idx_legal_consents_accepted_at ON legal_consents(accepted_at DESC);

-- Enable Row Level Security
ALTER TABLE legal_consents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own legal consent records
DROP POLICY IF EXISTS "Users can view their own legal consents" ON legal_consents;
CREATE POLICY "Users can view their own legal consents"
    ON legal_consents
    FOR SELECT
    USING (
        auth.uid() = user_id 
        OR user_id IN (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

-- Policy: Service role / server-side can insert legal consent records
DROP POLICY IF EXISTS "Service role can insert legal consents" ON legal_consents;
CREATE POLICY "Service role can insert legal consents"
    ON legal_consents
    FOR INSERT
    WITH CHECK (true);
