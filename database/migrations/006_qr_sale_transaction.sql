-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 006: QR SALE TRANSACTION
-- Atomic sale completion — all steps succeed or all fail
-- This is the most critical function in the entire system
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION complete_sale_transaction(
    p_product_id        UUID,
    p_qr_transaction_id UUID,
    p_seller_id         UUID,
    p_buyer_id          UUID,
    p_conversation_id   UUID
)
RETURNS JSONB AS $$
DECLARE
    v_sold_at           TIMESTAMPTZ := NOW();
    v_auto_remove_at    TIMESTAMPTZ := NOW() + INTERVAL '24 hours';
    v_product_title     VARCHAR(200);
    v_product_price     DECIMAL(12, 2);
    v_store_id          UUID;
BEGIN
    -- ── Step 1: Lock product row to prevent race conditions ──────────
    -- FOR UPDATE ensures no concurrent scan can modify this row
    SELECT title, price, store_id
    INTO v_product_title, v_product_price, v_store_id
    FROM products
    WHERE id        = p_product_id
      AND seller_id = p_seller_id
      AND is_deleted = FALSE
      AND status IN ('available', 'reserved')
    FOR UPDATE NOWAIT;  -- NOWAIT = fail immediately if another tx holds lock

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_AVAILABLE'
            USING
                DETAIL  = 'Product is not available for sale or does not belong to seller',
                HINT    = 'Check product status and seller ownership';
    END IF;

    -- ── Step 2: Mark product as SOLD ────────────────────────────────
    UPDATE products
    SET
        status          = 'sold',
        sold_at         = v_sold_at,
        auto_remove_at  = v_auto_remove_at,
        updated_at      = v_sold_at
    WHERE id = p_product_id;

    -- ── Step 3: Mark QR transaction as scanned ──────────────────────
    UPDATE qr_transactions
    SET
        status      = 'scanned',
        scanned_at  = v_sold_at
    WHERE id            = p_qr_transaction_id
      AND status        = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'QR_TRANSACTION_INVALID'
            USING DETAIL = 'QR transaction not found or not in pending status';
    END IF;

    -- ── Step 4: Mark conversation as completed ──────────────────────
    UPDATE conversations
    SET
        status      = 'completed',
        updated_at  = v_sold_at
    WHERE id = p_conversation_id;

    -- ── Step 5: Update seller_stats atomically ──────────────────────
    INSERT INTO seller_stats (
        user_id,
        total_sales,
        active_listings,
        updated_at
    )
    VALUES (
        p_seller_id,
        1,
        0,
        v_sold_at
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
        total_sales     = seller_stats.total_sales + 1,
        active_listings = GREATEST(0, seller_stats.active_listings - 1),
        updated_at      = v_sold_at;

    -- ── Step 6: Update store total_sales ────────────────────────────
    UPDATE stores
    SET
        total_sales = total_sales + 1,
        updated_at  = v_sold_at
    WHERE id = v_store_id;

    -- ── Step 7: Insert system message into conversation ──────────────
    -- Visible to both buyer and seller in chat
    INSERT INTO messages (
        conversation_id,
        sender_id,
        content,
        content_type,
        created_at
    )
    VALUES (
        p_conversation_id,
        p_seller_id,
        '✅ Sale completed! Thank you for using our marketplace. Please leave a review.',
        'system',
        v_sold_at
    );

    -- ── Step 8: Update conversation last message ─────────────────────
    UPDATE conversations
    SET
        last_message_at         = v_sold_at,
        last_message_preview    = '✅ Sale completed!',
        updated_at              = v_sold_at
    WHERE id = p_conversation_id;

    -- ── Return result payload ────────────────────────────────────────
    RETURN jsonb_build_object(
        'success',          true,
        'sold_at',          v_sold_at,
        'auto_remove_at',   v_auto_remove_at,
        'product_title',    v_product_title,
        'product_price',    v_product_price,
        'store_id',         v_store_id
    );

EXCEPTION
    -- Lock contention — another transaction is processing
    WHEN lock_not_available THEN
        RAISE EXCEPTION 'CONCURRENT_SALE_ATTEMPT'
            USING DETAIL = 'Another transaction is currently processing this product';

    -- Re-raise our custom exceptions
    WHEN SQLSTATE 'P0001' THEN
        RAISE;

    -- Any other unexpected error
    WHEN OTHERS THEN
        RAISE EXCEPTION 'SALE_TRANSACTION_FAILED: %', SQLERRM
            USING DETAIL = 'Unexpected error during sale transaction';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Expire stale QR tokens
-- Updates pending QRs past their expiry to 'expired'
-- Called by background job every 5 minutes
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_stale_qr_tokens()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE qr_transactions
    SET status = 'expired'
    WHERE status    = 'pending'
      AND expires_at < NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Revert any products that were reserved by now-expired QRs
    UPDATE products p
    SET
        status      = 'available',
        updated_at  = NOW()
    FROM qr_transactions qt
    WHERE qt.product_id = p.id
      AND qt.status     = 'expired'
      AND p.status      = 'reserved'
      AND qt.expires_at >= NOW() - INTERVAL '10 minutes';

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Cancel all pending QRs for product
-- Called before generating a new QR
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_product_pending_qrs(
    p_product_id    UUID,
    p_reason        TEXT DEFAULT 'replaced'
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE qr_transactions
    SET
        status              = 'cancelled',
        cancelled_at        = NOW(),
        cancellation_reason = p_reason
    WHERE product_id    = p_product_id
      AND status        = 'pending';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;