-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 016: BACKFILL REVIEWS PRODUCT_ID
-- Backfills product_id in reviews table from qr_transactions
-- and recalculates store/seller ratings for all historical records.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Backfill product_id in reviews from qr_transactions if null
UPDATE reviews r
SET product_id = qt.product_id
FROM qr_transactions qt
WHERE r.qr_transaction_id = qt.id
  AND r.product_id IS NULL;

-- 2. Recalculate ratings for all sellers (which also updates stores)
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
            -- Ignore errors for individual sellers
            NULL;
        END;
    END LOOP;
END;
$$;
