-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 021: BROWSE PRODUCTS NEARBY
-- Defines the search and discover RPC with recursive category checks
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION browse_products_nearby(
    p_lat         DECIMAL,
    p_lng         DECIMAL,
    p_radius_km   DECIMAL,
    p_category_id UUID DEFAULT NULL,
    p_min_price   DECIMAL DEFAULT NULL,
    p_max_price   DECIMAL DEFAULT NULL,
    p_condition   VARCHAR DEFAULT NULL,
    p_status      VARCHAR DEFAULT 'available',
    p_sort        VARCHAR DEFAULT 'newest',
    p_limit       INTEGER DEFAULT 20,
    p_offset      INTEGER DEFAULT 0
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
DECLARE
    v_category_ids UUID[] := '{}';
BEGIN
    -- If category is provided, get all its children recursively (Level 1 -> 2 -> 3)
    IF p_category_id IS NOT NULL THEN
        WITH RECURSIVE cat_tree AS (
            SELECT id FROM categories WHERE id = p_category_id
            UNION ALL
            SELECT c.id FROM categories c
            JOIN cat_tree ct ON c.parent_id = ct.id
        )
        SELECT array_agg(cat_tree.id) INTO v_category_ids FROM cat_tree;
    END IF;

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
        p.status        = p_status
        AND p.is_deleted = FALSE
        AND p.location_lat IS NOT NULL
        AND p.location_lng IS NOT NULL
        AND (p_category_id IS NULL OR p.category_id = ANY(v_category_ids))
        AND (p_min_price IS NULL OR p.price >= p_min_price)
        AND (p_max_price IS NULL OR p.price <= p_max_price)
        AND (p_condition IS NULL OR p.condition = p_condition)
        AND earth_distance(
            ll_to_earth(p_lat, p_lng),
            ll_to_earth(p.location_lat, p.location_lng)
        ) <= (p_radius_km * 1000)
    ORDER BY
        CASE WHEN p_sort = 'price_asc' THEN p.price END ASC,
        CASE WHEN p_sort = 'price_desc' THEN p.price END DESC,
        CASE WHEN p_sort = 'popular' THEN p.view_count END DESC,
        CASE WHEN p_sort = 'oldest' THEN p.created_at END ASC,
        CASE WHEN p_sort = 'newest' OR p_sort IS NULL THEN p.created_at END DESC,
        distance_km ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
