-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 004: PRODUCT FUNCTIONS (CORRECTED)
-- Atomic view/favorite counters, nearby search, recommendations
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- FUNCTION: Increment product view count
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_product_view_count(product_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE products
    SET
        view_count  = view_count + 1,
        updated_at  = NOW()
    WHERE id = product_id
      AND is_deleted = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Increment product favorite count
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_product_favorite_count(product_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE products
    SET
        favorite_count  = favorite_count + 1,
        updated_at      = NOW()
    WHERE id = product_id
      AND is_deleted = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Decrement product favorite count
-- Never goes below zero
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION decrement_product_favorite_count(product_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE products
    SET
        favorite_count  = GREATEST(0, favorite_count - 1),
        updated_at      = NOW()
    WHERE id = product_id
      AND is_deleted = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Refresh seller listing stats
-- Called after product create / update / delete
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_seller_listing_stats(p_seller_id UUID)
RETURNS void AS $$
DECLARE
    v_total  INTEGER;
    v_active INTEGER;
BEGIN
    SELECT
        COUNT(*) FILTER (WHERE is_deleted = FALSE),
        COUNT(*) FILTER (WHERE status = 'available' AND is_deleted = FALSE)
    INTO v_total, v_active
    FROM products
    WHERE seller_id = p_seller_id;

    -- ✅ Use INSERT ... ON CONFLICT to handle missing seller_stats rows
    INSERT INTO seller_stats (user_id, total_listings, active_listings, updated_at)
    VALUES (p_seller_id, COALESCE(v_total, 0), COALESCE(v_active, 0), NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
        total_listings  = COALESCE(v_total, 0),
        active_listings = COALESCE(v_active, 0),
        updated_at      = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Get nearby products (earthdistance)
-- Returns distance in km for each product
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_nearby_products(
    p_lat       DECIMAL,
    p_lng       DECIMAL,
    p_radius_km DECIMAL,
    p_limit     INTEGER DEFAULT 20
)
RETURNS TABLE (
    id              UUID,
    title           VARCHAR,
    slug            VARCHAR,
    price           DECIMAL,
    currency        VARCHAR,
    condition       VARCHAR,
    location_city   VARCHAR,
    location_lat    DECIMAL,
    location_lng    DECIMAL,
    view_count      INTEGER,
    favorite_count  INTEGER,
    distance_km     DECIMAL,
    created_at      TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.title,
        p.slug,
        p.price,
        p.currency,
        p.condition,
        p.location_city,
        p.location_lat,
        p.location_lng,
        p.view_count,
        p.favorite_count,
        ROUND(
            (earth_distance(
                ll_to_earth(p_lat, p_lng),
                ll_to_earth(p.location_lat, p.location_lng)
            ) / 1000.0)::numeric,
            2
        ) AS distance_km,
        p.created_at
    FROM products p
    WHERE
        p.status        = 'available'
        AND p.is_deleted = FALSE
        AND p.location_lat IS NOT NULL
        AND p.location_lng IS NOT NULL
        AND earth_distance(
            ll_to_earth(p_lat, p_lng),
            ll_to_earth(p.location_lat, p.location_lng)
        ) <= (p_radius_km * 1000)
    ORDER BY distance_km ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Get recommended products
-- Personalized feed using weighted scoring
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_recommended_products(
    p_user_id   UUID,
    p_limit     INTEGER DEFAULT 20
)
RETURNS TABLE (
    id              UUID,
    title           VARCHAR,
    slug            VARCHAR,
    price           DECIMAL,
    currency        VARCHAR,
    condition       VARCHAR,
    location_city   VARCHAR,
    view_count      INTEGER,
    favorite_count  INTEGER,
    relevance_score DECIMAL,
    created_at      TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    WITH user_categories AS (
        SELECT p.category_id, COUNT(*) AS interaction_count
        FROM favorites f
        JOIN products p ON f.product_id = p.id
        WHERE f.user_id = p_user_id
        GROUP BY p.category_id
    ),
    user_price_range AS (
        SELECT
            COALESCE(
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY p.price), 0
            ) AS p25,
            COALESCE(
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY p.price), 999999
            ) AS p75
        FROM favorites f
        JOIN products p ON f.product_id = p.id
        WHERE f.user_id = p_user_id
    ),
    followed_stores AS (
        SELECT store_id
        FROM store_followers
        WHERE follower_id = p_user_id
    )
    SELECT
        p.id,
        p.title,
        p.slug,
        p.price,
        p.currency,
        p.condition,
        p.location_city,
        p.view_count,
        p.favorite_count,
        (
            COALESCE(
                (SELECT uc.interaction_count::DECIMAL
                 FROM user_categories uc
                 WHERE uc.category_id = p.category_id),
                0
            ) * 3.0
            +
            CASE
                WHEN p.store_id IN (SELECT store_id FROM followed_stores) THEN 5.0
                ELSE 0.0
            END
            +
            CASE
                WHEN p.price BETWEEN
                    (SELECT p25 FROM user_price_range) AND
                    (SELECT p75 FROM user_price_range)
                THEN 2.0
                ELSE 0.0
            END
            +
            CASE
                WHEN p.created_at > NOW() - INTERVAL '7 days' THEN 1.0
                ELSE 0.0
            END
        )::DECIMAL AS relevance_score,
        p.created_at
    FROM products p
    WHERE
        p.status        = 'available'
        AND p.is_deleted = FALSE
        AND p.seller_id  != p_user_id
        AND p.id NOT IN (
            SELECT product_id FROM favorites WHERE user_id = p_user_id
        )
    ORDER BY relevance_score DESC, p.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;