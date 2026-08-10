-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 007: REVIEW FUNCTIONS
-- Seller rating recalculation and review analytics
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- FUNCTION: Update seller average rating
-- Called after every new buyer review
-- Also updates the associated store rating
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_seller_average_rating(p_seller_id UUID)
RETURNS void AS $$
DECLARE
    v_avg       DECIMAL(3, 2);
    v_count     INTEGER;
    v_store_id  UUID;
BEGIN
    -- Calculate new average from all visible buyer reviews
    SELECT
        ROUND(AVG(rating)::numeric, 2),
        COUNT(*)
    INTO v_avg, v_count
    FROM reviews
    WHERE reviewee_id   = p_seller_id
      AND reviewer_type = 'buyer'
      AND is_visible    = TRUE;

    -- Update seller_stats
    UPDATE seller_stats
    SET
        average_rating  = COALESCE(v_avg, 0.00),
        total_reviews   = COALESCE(v_count, 0),
        updated_at      = NOW()
    WHERE user_id = p_seller_id;

    -- Also update the store's rating
    SELECT id INTO v_store_id
    FROM stores
    WHERE user_id   = p_seller_id
      AND is_deleted = FALSE
    LIMIT 1;

    IF v_store_id IS NOT NULL THEN
        PERFORM update_store_rating(v_store_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Get review statistics for a user
-- Returns rating breakdown + popular tags
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_user_review_stats(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total',            COUNT(*),
        'average_rating',   ROUND(AVG(rating)::numeric, 2),
        'rating_breakdown', jsonb_build_object(
            '5', COUNT(*) FILTER (WHERE rating = 5),
            '4', COUNT(*) FILTER (WHERE rating = 4),
            '3', COUNT(*) FILTER (WHERE rating = 3),
            '2', COUNT(*) FILTER (WHERE rating = 2),
            '1', COUNT(*) FILTER (WHERE rating = 1)
        ),
        'popular_tags', jsonb_build_object(
            'friendly',         COUNT(*) FILTER (WHERE tag_friendly = TRUE),
            'fast',             COUNT(*) FILTER (WHERE tag_fast = TRUE),
            'accurate',         COUNT(*) FILTER (WHERE tag_accurate = TRUE),
            'great_comm',       COUNT(*) FILTER (WHERE tag_great_comm = TRUE),
            'would_buy_again',  COUNT(*) FILTER (WHERE tag_would_buy_again = TRUE),
            'would_sell_again', COUNT(*) FILTER (WHERE tag_would_sell_again = TRUE)
        )
    )
    INTO v_result
    FROM reviews
    WHERE reviewee_id   = p_user_id
      AND is_visible    = TRUE;

    RETURN COALESCE(v_result, '{
        "total": 0,
        "average_rating": 0,
        "rating_breakdown": {"5":0,"4":0,"3":0,"2":0,"1":0},
        "popular_tags": {}
    }'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Check if review is eligible
-- Returns TRUE if reviewer can review this transaction
-- Validates: transaction completed, reviewer is participant,
--            has not already reviewed
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_review_eligible(
    p_transaction_id    UUID,
    p_reviewer_id       UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_transaction   RECORD;
    v_already_reviewed BOOLEAN;
BEGIN
    -- Get transaction
    SELECT id, buyer_id, seller_id, status
    INTO v_transaction
    FROM qr_transactions
    WHERE id = p_transaction_id;

    -- Must exist and be scanned
    IF NOT FOUND OR v_transaction.status != 'scanned' THEN
        RETURN FALSE;
    END IF;

    -- Reviewer must be participant
    IF v_transaction.buyer_id != p_reviewer_id
       AND v_transaction.seller_id != p_reviewer_id THEN
        RETURN FALSE;
    END IF;

    -- Must not have already reviewed
    SELECT EXISTS(
        SELECT 1 FROM reviews
        WHERE qr_transaction_id = p_transaction_id
          AND reviewer_id       = p_reviewer_id
    ) INTO v_already_reviewed;

    RETURN NOT v_already_reviewed;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Hide spam reviews (admin action)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION hide_review(
    p_review_id UUID,
    p_admin_id  UUID,
    p_reason    TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
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

    -- Recalculate seller rating after hiding review
    -- Get seller ID from the review
    DECLARE
        v_seller_id UUID;
    BEGIN
        SELECT reviewee_id INTO v_seller_id
        FROM reviews
        WHERE id = p_review_id
          AND reviewer_type = 'buyer';

        IF v_seller_id IS NOT NULL THEN
            PERFORM update_seller_average_rating(v_seller_id);
        END IF;
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;