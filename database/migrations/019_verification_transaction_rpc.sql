-- ─────────────────────────────────────────
-- MIGRATION: 019_verification_transaction_rpc.sql
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION review_seller_verification_transaction(
    p_verification_id UUID,
    p_reviewer_id UUID,
    p_status VARCHAR(20),
    p_rejection_reason TEXT,
    p_ip_address VARCHAR(45),
    p_notes TEXT
) RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_previous_status VARCHAR(20);
    v_new_status VARCHAR(20);
    v_draft RECORD;
    v_store_id UUID;
    v_slug VARCHAR(120);
    v_slug_base VARCHAR(120);
    v_slug_suffix INTEGER := 1;
    v_audit_id UUID;
    v_result JSONB;
BEGIN
    -- 1. Fetch user ID and current status
    SELECT user_id, status INTO v_user_id, v_previous_status
    FROM seller_verifications
    WHERE id = p_verification_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Verification record not found';
    END IF;

    -- 2. Determine statuses
    IF p_status = 'approved' THEN
        v_new_status := 'identity_verified';
    ELSE
        v_new_status := 'rejected';
    END IF;

    -- 3. Update seller_verifications status
    UPDATE seller_verifications
    SET status = p_status,
        verified_at = CASE WHEN p_status = 'approved' THEN NOW() ELSE verified_at END,
        updated_at = NOW()
    WHERE id = p_verification_id;

    -- 4. Update users verification status and role
    UPDATE users
    SET seller_verification_status = v_new_status,
        role = CASE 
            WHEN p_status = 'approved' AND role IN ('buyer', 'guest') THEN 'both'::varchar
            ELSE role 
        END,
        updated_at = NOW()
    WHERE id = v_user_id;

    -- 5. If approved, handle store draft promotion
    IF p_status = 'approved' THEN
        SELECT * INTO v_draft FROM store_drafts WHERE user_id = v_user_id;
        
        IF FOUND THEN
            -- Generate unique slug
            v_slug_base := LOWER(REGEXP_REPLACE(v_draft.store_name, '[^a-zA-Z0-9]+', '-', 'g'));
            v_slug_base := TRIM(BOTH '-' FROM v_slug_base);
            v_slug := v_slug_base;
            
            WHILE EXISTS (SELECT 1 FROM stores WHERE slug = v_slug) LOOP
                v_slug := v_slug_base || '-' || v_slug_suffix;
                v_slug_suffix := v_slug_suffix + 1;
            END LOOP;

            -- Create store
            INSERT INTO stores (
                user_id,
                category_id,
                store_name,
                slug,
                logo_url,
                banner_url,
                description,
                location_city,
                location_lat,
                location_lng,
                social_instagram,
                social_facebook,
                social_tiktok,
                is_verified,
                is_active
            ) VALUES (
                v_user_id,
                v_draft.category_id,
                v_draft.store_name,
                v_slug,
                v_draft.logo_url,
                v_draft.banner_url,
                v_draft.description,
                v_draft.location_city,
                v_draft.location_lat,
                v_draft.location_lng,
                v_draft.social_instagram,
                v_draft.social_facebook,
                v_draft.social_tiktok,
                TRUE, -- Automatically verify store since seller is verified
                TRUE
            ) RETURNING id INTO v_store_id;

            -- Delete from store_drafts
            DELETE FROM store_drafts WHERE user_id = v_user_id;
        END IF;
    END IF;

    -- 6. Insert audit log
    INSERT INTO seller_verification_audit_logs (
        verification_id,
        reviewer_id,
        previous_status,
        new_status,
        rejection_reason,
        ip_address,
        notes
    ) VALUES (
        p_verification_id,
        p_reviewer_id,
        v_previous_status,
        p_status,
        p_rejection_reason,
        p_ip_address,
        p_notes
    ) RETURNING id INTO v_audit_id;

    -- Build return JSON
    v_result := JSONB_BUILD_OBJECT(
        'success', TRUE,
        'verification_id', p_verification_id,
        'user_id', v_user_id,
        'new_status', v_new_status,
        'store_created', v_store_id IS NOT NULL,
        'store_id', v_store_id,
        'audit_id', v_audit_id
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;
