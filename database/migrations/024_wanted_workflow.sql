-- =============================================================================
-- Migration 024: Wanted Requests and Matching Workflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS wanted_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category            VARCHAR(50) NOT NULL DEFAULT 'real_estate',
    title               VARCHAR(255) NOT NULL,
    intent              VARCHAR(50) DEFAULT 'buy',
    item_type           VARCHAR(100),
    description         TEXT,
    budget_min          DECIMAL(12, 2) DEFAULT 0,
    budget_max          DECIMAL(12, 2) DEFAULT 0,
    currency            VARCHAR(10) DEFAULT 'USD',
    location_city       VARCHAR(150),
    location_lat        DECIMAL(10, 7),
    location_lng        DECIMAL(10, 7),
    location_radius     INTEGER DEFAULT 10,
    preferred_areas     TEXT[] DEFAULT '{}',
    features            TEXT[] DEFAULT '{}',
    bedrooms            VARCHAR(20),
    bathrooms           VARCHAR(20),
    property_size       VARCHAR(50),
    parking_important   BOOLEAN DEFAULT FALSE,
    duration_days       INTEGER DEFAULT 30,
    expires_at          TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    metadata            JSONB DEFAULT '{}'::jsonb,
    status              VARCHAR(30) DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'fulfilled', 'cancelled', 'expired')),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wanted_requests_buyer ON wanted_requests(buyer_id);
CREATE INDEX IF NOT EXISTS idx_wanted_requests_category ON wanted_requests(category);
CREATE INDEX IF NOT EXISTS idx_wanted_requests_status ON wanted_requests(status);
CREATE INDEX IF NOT EXISTS idx_wanted_requests_created ON wanted_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wanted_requests_location ON wanted_requests(location_city);

CREATE TABLE IF NOT EXISTS wanted_matches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wanted_request_id   UUID NOT NULL REFERENCES wanted_requests(id) ON DELETE CASCADE,
    seller_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id          UUID REFERENCES products(id) ON DELETE SET NULL,
    message             TEXT,
    status              VARCHAR(30) DEFAULT 'pending'
                        CHECK (status IN ('pending', 'viewed', 'accepted', 'declined')),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wanted_matches_request ON wanted_matches(wanted_request_id);
CREATE INDEX IF NOT EXISTS idx_wanted_matches_seller ON wanted_matches(seller_id);
CREATE INDEX IF NOT EXISTS idx_wanted_matches_product ON wanted_matches(product_id);
CREATE INDEX IF NOT EXISTS idx_wanted_matches_created ON wanted_matches(created_at DESC);

-- Allow notification types for wanted workflow
DO $$
BEGIN
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'new_message', 'new_follower', 'price_update',
        'product_sold', 'review_received', 'admin_message',
        'qr_generated', 'badge_earned', 'report_resolved',
        'wanted_match', 'wanted_reply', 'wanted_request_response'
    ));
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;
