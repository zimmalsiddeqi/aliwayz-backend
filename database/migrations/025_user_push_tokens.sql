-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 025: USER PUSH TOKENS TABLE (Multi-Device FCM Support)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_push_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT NOT NULL,
    platform        VARCHAR(20) NOT NULL DEFAULT 'android', -- 'android', 'ios', 'web'
    device_id       TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_used_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_push_token UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_token ON user_push_tokens(token);
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_active ON user_push_tokens(user_id, is_active);

-- Enable Row Level Security
ALTER TABLE user_push_tokens ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can manage their own push tokens" ON user_push_tokens;
DROP POLICY IF EXISTS "Service role full access to push tokens" ON user_push_tokens;

-- Policy: Users can view and manage their own push tokens
CREATE POLICY "Users can manage their own push tokens"
    ON user_push_tokens
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Service role has full access for backend worker/server operations
CREATE POLICY "Service role full access to push tokens"
    ON user_push_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
