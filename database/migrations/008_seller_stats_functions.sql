-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 008: SELLER STATS + UTILITY FUNCTIONS
-- Auto updated_at triggers, seller follower counts,
-- cleanup utilities, and Row Level Security policies
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- FUNCTION: Auto-set updated_at on row update
-- Applied to all mutable tables via trigger
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all mutable tables
DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY[
        'users',
        'stores',
        'products',
        'conversations',
        'seller_stats',
        'reports',
        'notifications',
        'badges',
        'payment_accounts',
        'seller_wallets',
        'escrow_transactions',
        'orders',
        'shipping_addresses'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS set_updated_at ON %I;
             CREATE TRIGGER set_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW
             EXECUTE FUNCTION trigger_set_updated_at();',
            tbl, tbl
        );
    END LOOP;
END;
$$;

-- ─────────────────────────────────────────
-- FUNCTION: Increment seller followers in seller_stats
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_seller_followers(p_seller_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO seller_stats (user_id, total_followers, updated_at)
    VALUES (p_seller_id, 1, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
        total_followers = seller_stats.total_followers + 1,
        updated_at      = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Decrement seller followers in seller_stats
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION decrement_seller_followers(p_seller_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE seller_stats
    SET
        total_followers = GREATEST(0, total_followers - 1),
        updated_at      = NOW()
    WHERE user_id = p_seller_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Full platform analytics for admin
-- Returns snapshot of platform health metrics
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_platform_analytics()
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'users', jsonb_build_object(
            'total',        (SELECT COUNT(*) FROM users WHERE is_deleted = FALSE),
            'active',       (SELECT COUNT(*) FROM users WHERE account_status = 'active' AND is_deleted = FALSE),
            'sellers',      (SELECT COUNT(*) FROM users WHERE role IN ('seller','both') AND is_deleted = FALSE),
            'new_today',    (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE AND is_deleted = FALSE),
            'new_week',     (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - 7 AND is_deleted = FALSE)
        ),
        'products', jsonb_build_object(
            'total',        (SELECT COUNT(*) FROM products WHERE is_deleted = FALSE),
            'available',    (SELECT COUNT(*) FROM products WHERE status = 'available' AND is_deleted = FALSE),
            'sold',         (SELECT COUNT(*) FROM products WHERE status = 'sold'),
            'new_today',    (SELECT COUNT(*) FROM products WHERE created_at >= CURRENT_DATE AND is_deleted = FALSE)
        ),
        'stores', jsonb_build_object(
            'total',        (SELECT COUNT(*) FROM stores WHERE is_deleted = FALSE),
            'verified',     (SELECT COUNT(*) FROM stores WHERE is_verified = TRUE AND is_deleted = FALSE)
        ),
        'transactions', jsonb_build_object(
            'total_sales',      (SELECT COUNT(*) FROM qr_transactions WHERE status = 'scanned'),
            'sales_today',      (SELECT COUNT(*) FROM qr_transactions WHERE status = 'scanned' AND scanned_at >= CURRENT_DATE),
            'sales_week',       (SELECT COUNT(*) FROM qr_transactions WHERE status = 'scanned' AND scanned_at >= CURRENT_DATE - 7),
            'pending_qrs',      (SELECT COUNT(*) FROM qr_transactions WHERE status = 'pending' AND expires_at > NOW())
        ),
        'moderation', jsonb_build_object(
            'pending_reports',  (SELECT COUNT(*) FROM reports WHERE status = 'pending'),
            'suspended_users',  (SELECT COUNT(*) FROM users WHERE account_status = 'suspended'),
            'banned_users',     (SELECT COUNT(*) FROM users WHERE account_status = 'banned')
        ),
        'generated_at', NOW()
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Cleanup old notifications
-- Removes read notifications older than 30 days
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_old_notifications(p_days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM notifications
    WHERE is_read   = TRUE
      AND created_at < NOW() - (p_days_old || ' days')::INTERVAL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Cleanup old product views
-- Keeps only last 90 days for analytics
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_old_product_views(p_days_old INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM product_views
    WHERE created_at < NOW() - (p_days_old || ' days')::INTERVAL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Full cleanup routine
-- Run weekly via scheduler
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION run_weekly_cleanup()
RETURNS JSONB AS $$
DECLARE
    v_auth_tokens   INTEGER := 0;
    v_notifications INTEGER := 0;
    v_views         INTEGER := 0;
    v_conversations INTEGER := 0;
BEGIN
    -- Cleanup expired auth tokens
    PERFORM cleanup_expired_auth_tokens();

    -- Cleanup old notifications (30 days)
    v_notifications := cleanup_old_notifications(30);

    -- Cleanup old product views (90 days)
    v_views := cleanup_old_product_views(90);

    -- Archive old completed conversations (90 days)
    v_conversations := archive_old_conversations();

    RETURN jsonb_build_object(
        'notifications_deleted',    v_notifications,
        'views_deleted',            v_views,
        'conversations_archived',   v_conversations,
        'run_at',                   NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY POLICIES
-- Applied to sensitive tables
-- Supabase enforces these at the DB level
-- ─────────────────────────────────────────

-- Enable RLS on all sensitive tables
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_stats        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges         ENABLE ROW LEVEL SECURITY;
ALTER TABLE badge_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites           ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_followers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs          ENABLE ROW LEVEL SECURITY;

-- ── Users ──────────────────────────────────────────────────────────
-- Service role (our backend) bypasses RLS automatically
-- These policies apply to anon/authenticated Supabase client access

CREATE POLICY "users_public_read" ON users
    FOR SELECT
    USING (is_deleted = FALSE AND account_status = 'active');

CREATE POLICY "users_own_full_access" ON users
    FOR ALL
    USING (auth.uid()::text = supabase_uid::text);

-- ── Notifications ──────────────────────────────────────────────────
CREATE POLICY "notifications_own_only" ON notifications
    FOR ALL
    USING (
        user_id = (
            SELECT id FROM users WHERE supabase_uid = auth.uid()
        )
    );

-- ── Conversations ──────────────────────────────────────────────────
CREATE POLICY "conversations_participants_only" ON conversations
    FOR ALL
    USING (
        buyer_id  = (SELECT id FROM users WHERE supabase_uid = auth.uid())
        OR
        seller_id = (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

-- ── Messages ───────────────────────────────────────────────────────
CREATE POLICY "messages_conversation_participants" ON messages
    FOR ALL
    USING (
        conversation_id IN (
            SELECT id FROM conversations
            WHERE buyer_id  = (SELECT id FROM users WHERE supabase_uid = auth.uid())
               OR seller_id = (SELECT id FROM users WHERE supabase_uid = auth.uid())
        )
    );

-- ── Favorites ──────────────────────────────────────────────────────
CREATE POLICY "favorites_own_only" ON favorites
    FOR ALL
    USING (
        user_id = (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

-- ── Store Followers ────────────────────────────────────────────────
CREATE POLICY "store_followers_own_only" ON store_followers
    FOR ALL
    USING (
        follower_id = (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

-- ── QR Transactions ────────────────────────────────────────────────
CREATE POLICY "qr_transactions_participants_only" ON qr_transactions
    FOR SELECT
    USING (
        seller_id = (SELECT id FROM users WHERE supabase_uid = auth.uid())
        OR
        buyer_id  = (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

-- ── Reviews ────────────────────────────────────────────────────────
CREATE POLICY "reviews_public_read" ON reviews
    FOR SELECT
    USING (is_visible = TRUE);

CREATE POLICY "reviews_own_write" ON reviews
    FOR INSERT
    WITH CHECK (
        reviewer_id = (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

-- ── Refresh Tokens ─────────────────────────────────────────────────
CREATE POLICY "refresh_tokens_own_only" ON refresh_tokens
    FOR ALL
    USING (
        user_id = (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

-- ── Admin Logs ─────────────────────────────────────────────────────
-- Admin logs are only accessible via service role (our backend)
-- No direct client access policy needed
CREATE POLICY "admin_logs_no_direct_access" ON admin_logs
    FOR ALL
    USING (FALSE);  -- Block all direct client access

-- ── Reports ────────────────────────────────────────────────────────
CREATE POLICY "reports_own_read" ON reports
    FOR SELECT
    USING (
        reporter_id = (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

CREATE POLICY "reports_authenticated_write" ON reports
    FOR INSERT
    WITH CHECK (
        reporter_id = (SELECT id FROM users WHERE supabase_uid = auth.uid())
    );

-- ─────────────────────────────────────────
-- GRANT service role permissions
-- Our Fastify backend uses service role — bypasses RLS
-- ─────────────────────────────────────────
-- These are set automatically in Supabase for service_role
-- Included here for documentation purposes

-- GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
-- GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;