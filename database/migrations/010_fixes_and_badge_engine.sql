-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 010: CRITICAL FIXES + BADGE ENGINE
-- Fixes: hide_review nested DECLARE, expire_stale_qr logic,
--        seller_stats auto-create, auto_remove_sold_products,
--        missing location_state, badge evaluation engine
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- FIX 1: Add missing location_state to users
-- ─────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS location_state VARCHAR(100);

-- ─────────────────────────────────────────
-- FIX 2: Auto-create seller_stats on role change
-- Prevents NULL stats for new sellers
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_create_seller_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role IN ('seller', 'both') AND
       (OLD IS NULL OR OLD.role NOT IN ('seller', 'both')) THEN
        INSERT INTO seller_stats (user_id, updated_at)
        VALUES (NEW.id, NOW())
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_create_seller_stats ON users;
CREATE TRIGGER trg_auto_create_seller_stats
    AFTER INSERT OR UPDATE OF role ON users
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_seller_stats();

-- ─────────────────────────────────────────
-- FIX 3: Fixed expire_stale_qr_tokens
-- Removed buggy 10-minute time window
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_stale_qr_tokens()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Mark pending QRs past expiry as expired
    UPDATE qr_transactions
    SET status = 'expired'
    WHERE status    = 'pending'
      AND expires_at < NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Revert ALL reserved products linked to expired QRs
    -- No time window — catch all missed reversions
    UPDATE products p
    SET
        status      = 'available',
        updated_at  = NOW()
    FROM qr_transactions qt
    WHERE qt.product_id = p.id
      AND qt.status     = 'expired'
      AND p.status      = 'reserved';

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FIX 4: Fixed hide_review (no nested DECLARE)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION hide_review(
    p_review_id UUID,
    p_admin_id  UUID,
    p_reason    TEXT DEFAULT NULL
)
RETURNS void AS $$
DECLARE
    v_seller_id UUID;
BEGIN
    -- Hide the review
    UPDATE reviews
    SET is_visible = FALSE
    WHERE id = p_review_id;

    -- Log admin action
    INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
    VALUES (
        p_admin_id,
        'review_hidden',
        'review',
        p_review_id,
        jsonb_build_object('reason', p_reason)
    );

    -- Get seller ID from the review
    SELECT reviewee_id INTO v_seller_id
    FROM reviews
    WHERE id = p_review_id
      AND reviewer_type = 'buyer';

    -- Recalculate seller rating
    IF v_seller_id IS NOT NULL THEN
        PERFORM update_seller_average_rating(v_seller_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FIX 5: Auto-remove sold products after 24h
-- Called by background job every hour
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_remove_sold_products()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE products
    SET
        is_deleted  = TRUE,
        deleted_at  = NOW(),
        updated_at  = NOW()
    WHERE status        = 'sold'
      AND auto_remove_at IS NOT NULL
      AND auto_remove_at <= NOW()
      AND is_deleted    = FALSE;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- BADGE ENGINE: Full automated badge evaluation
-- Triggered after seller_stats update
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION evaluate_and_assign_badges(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_stats         RECORD;
    v_badge         RECORD;
    v_awarded       TEXT[] := '{}';
    v_revoked       TEXT[] := '{}';
    v_qualifies     BOOLEAN;
    v_already_has   BOOLEAN;
    v_phone_verified BOOLEAN;
BEGIN
    -- Get current seller stats
    SELECT
        ss.total_sales,
        ss.average_rating,
        ss.total_reviews,
        ss.badge_score,
        u.phone_verified,
        u.role,
        u.last_active_at
    INTO v_stats
    FROM seller_stats ss
    JOIN users u ON u.id = ss.user_id
    WHERE ss.user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'seller_stats not found');
    END IF;

    -- Evaluate each active badge
    FOR v_badge IN
        SELECT * FROM badges WHERE is_active = TRUE ORDER BY display_order
    LOOP
        v_qualifies := TRUE;

        -- Check sales threshold
        IF v_stats.total_sales < v_badge.min_sales THEN
            v_qualifies := FALSE;
        END IF;

        -- Check rating threshold (only if user has reviews)
        IF v_stats.total_reviews > 0 AND
           v_stats.average_rating < v_badge.min_rating THEN
            v_qualifies := FALSE;
        END IF;

        -- Check review count threshold
        IF v_stats.total_reviews < v_badge.min_reviews THEN
            v_qualifies := FALSE;
        END IF;

        -- Check phone verification requirement
        IF v_badge.requires_phone_verify AND
           NOT v_stats.phone_verified THEN
            v_qualifies := FALSE;
        END IF;

        -- Check if user already has badge
        SELECT EXISTS(
            SELECT 1 FROM user_badges
            WHERE user_id   = p_user_id
              AND badge_id  = v_badge.id
              AND is_active = TRUE
        ) INTO v_already_has;

        -- Award if qualifies and doesn't have badge
        IF v_qualifies AND NOT v_already_has THEN
            INSERT INTO user_badges (
                user_id, badge_id, awarded_at,
                is_active, award_reason
            )
            VALUES (
                p_user_id, v_badge.id, NOW(),
                TRUE, 'auto_evaluated'
            )
            ON CONFLICT (user_id, badge_id)
            DO UPDATE SET
                is_active   = TRUE,
                awarded_at  = NOW(),
                revoked_at  = NULL;

            INSERT INTO badge_history (
                user_id, badge_id, action,
                trigger_event, snapshot_stats
            )
            VALUES (
                p_user_id, v_badge.id, 'awarded',
                'evaluate_and_assign_badges',
                jsonb_build_object(
                    'total_sales',    v_stats.total_sales,
                    'average_rating', v_stats.average_rating,
                    'total_reviews',  v_stats.total_reviews
                )
            );

            v_awarded := v_awarded || v_badge.code;

        -- Revoke if no longer qualifies (only revocable badges)
        ELSIF NOT v_qualifies AND v_already_has
              AND v_badge.code NOT IN ('new_seller') THEN

            UPDATE user_badges
            SET
                is_active   = FALSE,
                revoked_at  = NOW()
            WHERE user_id   = p_user_id
              AND badge_id  = v_badge.id;

            INSERT INTO badge_history (
                user_id, badge_id, action, trigger_event
            )
            VALUES (
                p_user_id, v_badge.id, 'revoked',
                'evaluate_and_assign_badges'
            );

            v_revoked := v_revoked || v_badge.code;
        END IF;
    END LOOP;

    -- Update badge_score in seller_stats
    UPDATE seller_stats
    SET
        badge_score = (
            SELECT COALESCE(SUM(b.badge_score), 0)
            FROM user_badges ub
            JOIN badges b ON b.id = ub.badge_id
            WHERE ub.user_id    = p_user_id
              AND ub.is_active  = TRUE
        ),
        updated_at  = NOW()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
        'awarded',      v_awarded,
        'revoked',      v_revoked,
        'evaluated_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- TRIGGER: Auto-evaluate badges after seller_stats update
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_badge_evaluation()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.total_sales    IS DISTINCT FROM OLD.total_sales)   OR
       (NEW.average_rating IS DISTINCT FROM OLD.average_rating) OR
       (NEW.total_reviews  IS DISTINCT FROM OLD.total_reviews)  THEN
        PERFORM evaluate_and_assign_badges(NEW.user_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_badge_evaluation ON seller_stats;
CREATE TRIGGER trg_badge_evaluation
    AFTER UPDATE ON seller_stats
    FOR EACH ROW
    EXECUTE FUNCTION trigger_badge_evaluation();

-- ─────────────────────────────────────────
-- Add updated_at to notifications if missing
-- (patch for migration 009 ordering issue)
-- ─────────────────────────────────────────
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure notifications is in the updated_at trigger list
DROP TRIGGER IF EXISTS set_updated_at ON notifications;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();