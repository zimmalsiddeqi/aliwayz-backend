-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 012: NEW SELLER BADGE REVOCATION FIX
-- Re-evaluates new_seller badge to only qualify if total_reviews is 0
-- and allows it to be revoked when reviews/ratings are received.
-- ═══════════════════════════════════════════════════════════════════

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
    SELECT INTO v_stats
        ss.total_sales,
        ss.average_rating,
        ss.total_reviews,
        ss.badge_score,
        u.phone_verified,
        u.role,
        u.last_active_at
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

        -- Check new_seller exception: only qualifies if total_reviews is 0
        IF v_badge.code = 'new_seller' AND v_stats.total_reviews > 0 THEN
            v_qualifies := FALSE;
        END IF;

        -- Check if user already has badge
        v_already_has := EXISTS(
            SELECT 1 FROM user_badges
            WHERE user_id   = p_user_id
              AND badge_id  = v_badge.id
              AND is_active = TRUE
        );

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

        -- Revoke if no longer qualifies (only revocable badges - now including new_seller)
        ELSIF NOT v_qualifies AND v_already_has THEN
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

-- Revoke any existing active new_seller badge where total_reviews > 0
UPDATE user_badges ub
SET
    is_active = FALSE,
    revoked_at = NOW()
FROM badges b, seller_stats ss
WHERE ub.badge_id = b.id
  AND b.code = 'new_seller'
  AND ub.user_id = ss.user_id
  AND ss.total_reviews > 0
  AND ub.is_active = TRUE;
