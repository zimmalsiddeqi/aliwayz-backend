-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 002: AUTH SUPPORT TABLES
-- Refresh tokens, email verification, password reset
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- TABLE: refresh_tokens
-- Stores hashed refresh tokens for multi-device support
-- Raw token is NEVER stored — only SHA-256 hash
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    is_revoked  BOOLEAN DEFAULT FALSE,
    revoked_at  TIMESTAMPTZ,
    device_id   VARCHAR(255),
    device_name VARCHAR(255),
    ip_address  INET,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
    ON refresh_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash
    ON refresh_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active
    ON refresh_tokens(user_id, is_revoked)
    WHERE is_revoked = FALSE;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
    ON refresh_tokens(expires_at)
    WHERE is_revoked = FALSE;

-- ─────────────────────────────────────────
-- TABLE: email_verification_tokens
-- One active token per email (upsert on resend)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) UNIQUE NOT NULL,
    token_hash  VARCHAR(64) NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    is_used     BOOLEAN DEFAULT FALSE,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verify_email
    ON email_verification_tokens(email);

CREATE INDEX IF NOT EXISTS idx_email_verify_hash
    ON email_verification_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_email_verify_unused
    ON email_verification_tokens(email, is_used)
    WHERE is_used = FALSE;

-- ─────────────────────────────────────────
-- TABLE: password_reset_tokens
-- One active token per email (upsert on request)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) UNIQUE NOT NULL,
    token_hash  VARCHAR(64) NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    is_used     BOOLEAN DEFAULT FALSE,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_email
    ON password_reset_tokens(email);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_hash
    ON password_reset_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_unused
    ON password_reset_tokens(email, is_used)
    WHERE is_used = FALSE;

-- ─────────────────────────────────────────
-- FUNCTION: Cleanup expired auth tokens
-- Called by background job / cron
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_auth_tokens()
RETURNS void AS $$
BEGIN
    -- Remove old revoked refresh tokens
    DELETE FROM refresh_tokens
    WHERE expires_at < NOW()
      AND is_revoked = TRUE;

    -- Remove expired email verification tokens
    DELETE FROM email_verification_tokens
    WHERE expires_at < NOW();

    -- Remove expired password reset tokens
    DELETE FROM password_reset_tokens
    WHERE expires_at < NOW();

    RAISE NOTICE 'Expired auth tokens cleaned up at %', NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;