-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 017: TIE STORE RATINGS TO OWNER
-- Redefines update_store_rating and update_seller_average_rating
-- to associate store ratings with the owner's overall seller profile.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_store_rating(p_store_id UUID)
RETURNS void AS $$
DECLARE
    v_avg   DECIMAL(3, 2);
    v_count INTEGER;
    v_owner_id UUID;
BEGIN
    -- Get the store owner (using direct assignment to avoid INTO parser bug)
    v_owner_id := (SELECT user_id FROM stores WHERE id = p_store_id);

    -- Calculate rating metrics (using direct assignments to avoid INTO parser bug)
    v_avg := (
        SELECT ROUND(AVG(r.rating)::numeric, 2)
        FROM reviews r
        WHERE r.reviewee_id     = v_owner_id
          AND r.reviewer_type   = 'buyer'
          AND r.is_visible      = TRUE
    );

    v_count := (
        SELECT COUNT(*)
        FROM reviews r
        WHERE r.reviewee_id     = v_owner_id
          AND r.reviewer_type   = 'buyer'
          AND r.is_visible      = TRUE
    );

    UPDATE stores
    SET
        average_rating  = COALESCE(v_avg, 0.00),
        total_reviews   = COALESCE(v_count, 0),
        updated_at      = NOW()
    WHERE id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION update_seller_average_rating(p_seller_id UUID)
RETURNS void AS $$
DECLARE
    v_avg       DECIMAL(3, 2);
    v_count     INTEGER;
    v_store_id  UUID;
BEGIN
    -- Calculate rating metrics (using direct assignments to avoid INTO parser bug)
    v_avg := (
        SELECT ROUND(AVG(rating)::numeric, 2)
        FROM reviews
        WHERE reviewee_id   = p_seller_id
          AND reviewer_type = 'buyer'
          AND is_visible    = TRUE
    );

    v_count := (
        SELECT COUNT(*)
        FROM reviews
        WHERE reviewee_id   = p_seller_id
          AND reviewer_type = 'buyer'
          AND is_visible    = TRUE
    );

    -- Update seller_stats
    UPDATE seller_stats
    SET
        average_rating  = COALESCE(v_avg, 0.00),
        total_reviews   = COALESCE(v_count, 0),
        updated_at      = NOW()
    WHERE user_id = p_seller_id;

    -- Update all active stores of this seller
    FOR v_store_id IN
        SELECT id FROM stores
        WHERE user_id   = p_seller_id
          AND is_deleted = FALSE
    LOOP
        PERFORM update_store_rating(v_store_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Recalculate ratings for all sellers to update stats and all stores
DO $$
DECLARE
    v_seller_id UUID;
BEGIN
    FOR v_seller_id IN 
        SELECT DISTINCT reviewee_id 
        FROM reviews 
        WHERE reviewer_type = 'buyer'
    LOOP
        BEGIN
            PERFORM update_seller_average_rating(v_seller_id);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END;
$$;
