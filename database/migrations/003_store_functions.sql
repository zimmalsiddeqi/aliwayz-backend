-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 003: STORE FUNCTIONS
-- Atomic store follower counts and rating updates
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- FUNCTION: Increment store follower count
-- Called when a user follows a store
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_store_followers(store_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE stores
    SET
        total_followers = total_followers + 1,
        updated_at      = NOW()
    WHERE id = store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Decrement store follower count
-- Never goes below zero
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION decrement_store_followers(store_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE stores
    SET
        total_followers = GREATEST(0, total_followers - 1),
        updated_at      = NOW()
    WHERE id = store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Update store average rating
-- Called after each new buyer review is inserted
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_store_rating(p_store_id UUID)
RETURNS void AS $$
DECLARE
    v_avg   DECIMAL(3, 2);
    v_count INTEGER;
BEGIN
    -- Only count buyer reviews for store rating
    SELECT
        ROUND(AVG(r.rating)::numeric, 2),
        COUNT(*)
    INTO v_avg, v_count
    FROM reviews r
    JOIN products p ON r.product_id = p.id
    WHERE p.store_id      = p_store_id
      AND r.reviewer_type = 'buyer'
      AND r.is_visible    = TRUE;

    UPDATE stores
    SET
        average_rating  = COALESCE(v_avg, 0.00),
        total_reviews   = COALESCE(v_count, 0),
        updated_at      = NOW()
    WHERE id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Get popular stores
-- Ranked by badge_score + total_sales + rating
-- Used in home feed "Popular Stores" section
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_popular_stores(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    id              UUID,
    store_name      VARCHAR,
    slug            VARCHAR,
    logo_url        TEXT,
    location_city   VARCHAR,
    average_rating  DECIMAL,
    total_sales     INTEGER,
    total_followers INTEGER,
    is_verified     BOOLEAN,
    popularity_score DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.store_name,
        s.slug,
        s.logo_url,
        s.location_city,
        s.average_rating,
        s.total_sales,
        s.total_followers,
        s.is_verified,
        (
            COALESCE(ss.badge_score, 0) * 0.4 +
            COALESCE(s.total_sales, 0) * 0.3 +
            COALESCE(s.average_rating, 0) * 10 * 0.2 +
            COALESCE(s.total_followers, 0) * 0.1
        )::DECIMAL AS popularity_score
    FROM stores s
    LEFT JOIN seller_stats ss ON ss.user_id = s.user_id
    WHERE s.is_active   = TRUE
      AND s.is_deleted  = FALSE
    ORDER BY popularity_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────
-- FUNCTION: Get featured sellers
-- For home screen "Featured Sellers" section
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_featured_sellers(p_limit INTEGER DEFAULT 6)
RETURNS TABLE (
    user_id         UUID,
    username        VARCHAR,
    avatar_url      TEXT,
    store_id        UUID,
    store_name      VARCHAR,
    store_slug      VARCHAR,
    store_logo      TEXT,
    average_rating  DECIMAL,
    total_sales     INTEGER,
    badge_score     INTEGER,
    is_verified     BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id            AS user_id,
        u.username,
        u.avatar_url,
        s.id            AS store_id,
        s.store_name,
        s.slug          AS store_slug,
        s.logo_url      AS store_logo,
        s.average_rating,
        s.total_sales,
        COALESCE(ss.badge_score, 0) AS badge_score,
        s.is_verified
    FROM users u
    JOIN stores s ON s.user_id = u.id
    LEFT JOIN seller_stats ss ON ss.user_id = u.id
    WHERE u.account_status  = 'active'
      AND u.is_deleted      = FALSE
      AND s.is_active       = TRUE
      AND s.is_deleted      = FALSE
      AND s.is_verified     = TRUE
    ORDER BY ss.badge_score DESC, s.average_rating DESC, s.total_sales DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;