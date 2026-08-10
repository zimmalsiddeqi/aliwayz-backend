-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 005: CHAT FUNCTIONS
-- Atomic unread count management
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- FUNCTION: Increment unread count
-- Only increments for the RECEIVING party
-- p_is_buyer_sender = TRUE  → buyer sent → increment seller unread
-- p_is_buyer_sender = FALSE → seller sent → increment buyer unread
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_unread_count(
    p_conversation_id   UUID,
    p_is_buyer_sender   BOOLEAN
)
RETURNS void AS $$
BEGIN
    IF p_is_buyer_sender THEN
        UPDATE conversations
        SET
            seller_unread_count = seller_unread_count + 1,
            updated_at          = NOW()
        WHERE id = p_conversation_id;
    ELSE
        UPDATE conversations
        SET
            buyer_unread_count  = buyer_unread_count + 1,
            updated_at          = NOW()
        WHERE id = p_conversation_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Reset unread count for reader
-- Called when user opens a conversation
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION reset_unread_count(
    p_conversation_id   UUID,
    p_user_id           UUID
)
RETURNS void AS $$
DECLARE
    v_buyer_id UUID;
BEGIN
    SELECT buyer_id INTO v_buyer_id
    FROM conversations
    WHERE id = p_conversation_id;

    IF v_buyer_id = p_user_id THEN
        UPDATE conversations
        SET
            buyer_unread_count  = 0,
            updated_at          = NOW()
        WHERE id = p_conversation_id;
    ELSE
        UPDATE conversations
        SET
            seller_unread_count = 0,
            updated_at          = NOW()
        WHERE id = p_conversation_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Get total unread messages for user
-- Used for inbox badge count
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_user_total_unread(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_total INTEGER;
BEGIN
    SELECT
        COALESCE(SUM(
            CASE
                WHEN buyer_id  = p_user_id THEN buyer_unread_count
                WHEN seller_id = p_user_id THEN seller_unread_count
                ELSE 0
            END
        ), 0)
    INTO v_total
    FROM conversations
    WHERE (buyer_id = p_user_id OR seller_id = p_user_id)
      AND status != 'archived';

    RETURN v_total;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Archive old completed conversations
-- Called by cleanup job
-- Archives conversations completed > 90 days ago
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION archive_old_conversations()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE conversations
    SET
        status      = 'archived',
        updated_at  = NOW()
    WHERE status    = 'completed'
      AND updated_at < NOW() - INTERVAL '90 days';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;