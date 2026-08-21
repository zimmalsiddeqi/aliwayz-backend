-- ─────────────────────────────────────────
-- MIGRATION: 018_seller_verification.sql
-- ─────────────────────────────────────────

-- 1. Add verification status tracking to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS
    seller_verification_status VARCHAR(20) DEFAULT 'none'
    CHECK (seller_verification_status IN (
        'none',              -- Never submitted
        'pending',           -- Submitted, awaiting review
        'identity_verified', -- Verification successful
        'rejected'           -- Verification rejected
    ));

CREATE INDEX IF NOT EXISTS idx_users_verification_status
    ON users(seller_verification_status)
    WHERE seller_verification_status != 'none';

-- 2. Seller verifications table (Full history archived)
CREATE TABLE IF NOT EXISTS seller_verifications (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected')),
    
    -- Extensibility fields
    verification_method   VARCHAR(30) NOT NULL DEFAULT 'manual'
                          CHECK (verification_method IN ('manual', 'ai', 'hybrid')),
    verification_version  INTEGER NOT NULL DEFAULT 1,
    attempt_number        INTEGER NOT NULL DEFAULT 1,
    verification_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Encrypted PII (stored as hex-encoded encrypted strings)
    encrypted_full_legal_name TEXT NOT NULL,
    encrypted_date_of_birth   TEXT NOT NULL,
    key_version               VARCHAR(10) NOT NULL DEFAULT 'v1',
    
    -- Document validation
    id_type                  VARCHAR(50) NOT NULL,
    document_hash            VARCHAR(64) NOT NULL, -- SHA-256 fingerprint for duplicate detection
    document_expiration_date DATE NOT NULL,
    
    -- File URLs
    id_front_url          TEXT NOT NULL,
    id_back_url           TEXT, -- Optional for passports
    selfie_url            TEXT NOT NULL,
    
    -- Review and timestamps
    submitted_at          TIMESTAMPTZ DEFAULT NOW(),
    verified_at           TIMESTAMPTZ,
    expires_at            TIMESTAMPTZ DEFAULT NULL,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_verifications_user ON seller_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_seller_verifications_status ON seller_verifications(status);
CREATE INDEX IF NOT EXISTS idx_seller_verifications_doc_hash ON seller_verifications(document_hash);

-- Enable RLS
ALTER TABLE seller_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_verification ON seller_verifications;
DROP POLICY IF EXISTS insert_own_verification ON seller_verifications;

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

-- 3. Admin audit trail for verification changes (Immutable logs)
CREATE TABLE IF NOT EXISTS seller_verification_audit_logs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id  UUID NOT NULL REFERENCES seller_verifications(id) ON DELETE CASCADE,
    reviewer_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    previous_status  VARCHAR(20) NOT NULL,
    new_status       VARCHAR(20) NOT NULL,
    rejection_reason TEXT,
    ip_address       VARCHAR(45),
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_audit_logs_ref ON seller_verification_audit_logs(verification_id);

ALTER TABLE seller_verification_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select_logs ON seller_verification_audit_logs;

CREATE POLICY admin_select_logs ON seller_verification_audit_logs
    FOR SELECT USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM users WHERE (users.id = auth.uid() OR users.supabase_uid = auth.uid()) AND users.role = 'admin'
        )
    );

-- 4. Store drafts persistence table
CREATE TABLE IF NOT EXISTS store_drafts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    store_name       VARCHAR(100) NOT NULL,
    description      TEXT,
    category_id      UUID REFERENCES categories(id) ON DELETE SET NULL,
    location_city    VARCHAR(100),
    location_lat     DECIMAL(10, 8),
    location_lng     DECIMAL(11, 8),
    social_instagram VARCHAR(255),
    social_facebook  VARCHAR(255),
    social_tiktok    VARCHAR(255),
    logo_url         TEXT,
    banner_url       TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE store_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_own_draft ON store_drafts;

CREATE POLICY access_own_draft ON store_drafts
    FOR ALL USING (
        auth.role() = 'service_role' OR
        auth.uid() = user_id OR
        user_id IN (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );
