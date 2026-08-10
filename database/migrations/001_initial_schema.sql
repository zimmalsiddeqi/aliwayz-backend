-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 001: INITIAL SCHEMA (FIXED)
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- Enable required extensions
-- ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "cube";
CREATE EXTENSION IF NOT EXISTS "earthdistance";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─────────────────────────────────────────
-- TABLE: categories
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    slug            VARCHAR(110) UNIQUE NOT NULL,
    parent_id       UUID REFERENCES categories(id) ON DELETE SET NULL,
    icon_url        TEXT,
    display_order   INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_parent_id
    ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug
    ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_display_order
    ON categories(display_order ASC);
CREATE INDEX IF NOT EXISTS idx_categories_is_active
    ON categories(is_active)
    WHERE is_active = TRUE;

-- ─────────────────────────────────────────
-- TABLE: users
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(255) UNIQUE NOT NULL,
    username            VARCHAR(50) UNIQUE NOT NULL,
    full_name           VARCHAR(100),
    avatar_url          TEXT,
    bio                 TEXT,
    phone               VARCHAR(20),
    phone_verified      BOOLEAN DEFAULT FALSE,
    email_verified      BOOLEAN DEFAULT FALSE,
    role                VARCHAR(20) NOT NULL DEFAULT 'buyer'
                        CHECK (role IN ('guest', 'buyer', 'seller', 'both', 'admin')),
    account_status      VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (account_status IN ('active', 'suspended', 'banned', 'pending')),
    auth_provider       VARCHAR(20) DEFAULT 'email'
                        CHECK (auth_provider IN ('email', 'google', 'apple')),
    supabase_uid        UUID UNIQUE,
    fcm_token           TEXT,
    last_active_at      TIMESTAMPTZ,
    location_city       VARCHAR(100),
    location_lat        DECIMAL(10, 8),
    location_lng        DECIMAL(11, 8),
    is_deleted          BOOLEAN DEFAULT FALSE,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status);
CREATE INDEX IF NOT EXISTS idx_users_supabase_uid ON users(supabase_uid);
CREATE INDEX IF NOT EXISTS idx_users_is_deleted
    ON users(is_deleted) WHERE is_deleted = FALSE;

-- ✅ FIXED: Removed partial WHERE clause — ll_to_earth is immutable
-- but combining with WHERE on nullable columns causes issues in some PG versions
CREATE INDEX IF NOT EXISTS idx_users_location
    ON users USING GIST (ll_to_earth(location_lat, location_lng))
    WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL;

-- ─────────────────────────────────────────
-- TABLE: badges
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    VARCHAR(50) UNIQUE NOT NULL,
    name                    VARCHAR(100) NOT NULL,
    description             TEXT,
    icon_url                TEXT,
    min_sales               INTEGER DEFAULT 0,
    min_rating              DECIMAL(3, 2) DEFAULT 0.00,
    min_reviews             INTEGER DEFAULT 0,
    requires_phone_verify   BOOLEAN DEFAULT FALSE,
    badge_score             INTEGER DEFAULT 0,
    display_order           INTEGER DEFAULT 0,
    is_active               BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_badges_code ON badges(code);
CREATE INDEX IF NOT EXISTS idx_badges_is_active
    ON badges(is_active) WHERE is_active = TRUE;

-- ─────────────────────────────────────────
-- TABLE: seller_stats
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seller_stats (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_sales         INTEGER DEFAULT 0,
    total_listings      INTEGER DEFAULT 0,
    active_listings     INTEGER DEFAULT 0,
    total_views         INTEGER DEFAULT 0,
    total_favorites     INTEGER DEFAULT 0,
    average_rating      DECIMAL(3, 2) DEFAULT 0.00,
    total_reviews       INTEGER DEFAULT 0,
    total_followers     INTEGER DEFAULT 0,
    badge_score         INTEGER DEFAULT 0,
    response_rate       DECIMAL(5, 2) DEFAULT 0.00,
    last_active_at      TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_stats_user_id ON seller_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_seller_stats_badge_score ON seller_stats(badge_score DESC);
CREATE INDEX IF NOT EXISTS idx_seller_stats_average_rating ON seller_stats(average_rating DESC);
CREATE INDEX IF NOT EXISTS idx_seller_stats_total_sales ON seller_stats(total_sales DESC);

-- ─────────────────────────────────────────
-- TABLE: user_badges
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_badges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id        UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    awarded_at      TIMESTAMPTZ DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT TRUE,
    award_reason    TEXT,
    UNIQUE(user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id ON user_badges(badge_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_active
    ON user_badges(user_id, is_active) WHERE is_active = TRUE;

-- ─────────────────────────────────────────
-- TABLE: badge_history
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badge_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id        UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    action          VARCHAR(20) NOT NULL CHECK (action IN ('awarded', 'revoked')),
    trigger_event   VARCHAR(100),
    snapshot_stats  JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_badge_history_user_id ON badge_history(user_id);
CREATE INDEX IF NOT EXISTS idx_badge_history_created_at ON badge_history(created_at DESC);

-- ─────────────────────────────────────────
-- TABLE: stores
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    store_name          VARCHAR(100) NOT NULL,
    slug                VARCHAR(120) UNIQUE NOT NULL,
    logo_url            TEXT,
    banner_url          TEXT,
    description         TEXT,
    location_city       VARCHAR(100),
    location_lat        DECIMAL(10, 8),
    location_lng        DECIMAL(11, 8),
    social_instagram    VARCHAR(255),
    social_facebook     VARCHAR(255),
    social_tiktok       VARCHAR(255),
    total_sales         INTEGER DEFAULT 0,
    total_followers     INTEGER DEFAULT 0,
    average_rating      DECIMAL(3, 2) DEFAULT 0.00,
    total_reviews       INTEGER DEFAULT 0,
    is_verified         BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT TRUE,
    is_deleted          BOOLEAN DEFAULT FALSE,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stores_user_id ON stores(user_id);
CREATE INDEX IF NOT EXISTS idx_stores_slug ON stores(slug);
CREATE INDEX IF NOT EXISTS idx_stores_category_id ON stores(category_id);
CREATE INDEX IF NOT EXISTS idx_stores_average_rating ON stores(average_rating DESC);
CREATE INDEX IF NOT EXISTS idx_stores_total_sales ON stores(total_sales DESC);
CREATE INDEX IF NOT EXISTS idx_stores_is_active
    ON stores(is_active) WHERE is_active = TRUE AND is_deleted = FALSE;

-- ✅ FIXED: Geo index without nullable WHERE
CREATE INDEX IF NOT EXISTS idx_stores_location
    ON stores USING GIST (ll_to_earth(location_lat, location_lng))
    WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stores_search
    ON stores USING GIN (
        to_tsvector('english', store_name || ' ' || COALESCE(description, ''))
    );

CREATE INDEX IF NOT EXISTS idx_stores_name_trgm
    ON stores USING GIN(store_name gin_trgm_ops);

-- ─────────────────────────────────────────
-- TABLE: products
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id     UUID NOT NULL REFERENCES categories(id),
    title           VARCHAR(200) NOT NULL,
    slug            VARCHAR(230) UNIQUE NOT NULL,
    description     TEXT,
    price           DECIMAL(12, 2) NOT NULL CHECK (price >= 0),
    currency        VARCHAR(3) DEFAULT 'USD',
    condition       VARCHAR(20) NOT NULL
                    CHECK (condition IN ('new', 'like_new', 'good', 'fair', 'poor')),
    brand           VARCHAR(100),
    color           VARCHAR(50),
    quantity        INTEGER DEFAULT 1 CHECK (quantity >= 0),
    status          VARCHAR(20) NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'reserved', 'sold', 'hidden', 'draft')),
    location_city   VARCHAR(100),
    location_lat    DECIMAL(10, 8),
    location_lng    DECIMAL(11, 8),
    view_count      INTEGER DEFAULT 0,
    favorite_count  INTEGER DEFAULT 0,
    is_featured     BOOLEAN DEFAULT FALSE,
    featured_until  TIMESTAMPTZ,
    sold_at         TIMESTAMPTZ,
    auto_remove_at  TIMESTAMPTZ,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    search_vector   TSVECTOR,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_view_count ON products(view_count DESC);

-- ✅ FIXED: Simplified partial indexes — no NOW() in predicates
CREATE INDEX IF NOT EXISTS idx_products_available
    ON products(status, created_at DESC)
    WHERE status = 'available' AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_products_is_featured
    ON products(is_featured, featured_until)
    WHERE is_featured = TRUE;

CREATE INDEX IF NOT EXISTS idx_products_auto_remove
    ON products(auto_remove_at)
    WHERE status = 'sold' AND is_deleted = FALSE;

-- ✅ FIXED: Geo index
CREATE INDEX IF NOT EXISTS idx_products_location
    ON products USING GIST (ll_to_earth(location_lat, location_lng))
    WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_search
    ON products USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_products_title_trgm
    ON products USING GIN(title gin_trgm_ops);

-- ─────────────────────────────────────────
-- TRIGGER: Auto-update product search_vector
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_product_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.brand, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_search_vector ON products;
CREATE TRIGGER trg_product_search_vector
    BEFORE INSERT OR UPDATE OF title, brand, description
    ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_product_search_vector();

-- ─────────────────────────────────────────
-- TABLE: product_images
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    storage_url     TEXT NOT NULL,
    cdn_url         TEXT,
    display_order   INTEGER DEFAULT 0,
    is_primary      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_primary
    ON product_images(product_id, is_primary) WHERE is_primary = TRUE;
CREATE INDEX IF NOT EXISTS idx_product_images_order
    ON product_images(product_id, display_order ASC);

-- ─────────────────────────────────────────
-- TABLE: product_videos
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_videos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    storage_url         TEXT NOT NULL,
    cdn_url             TEXT,
    thumbnail_url       TEXT,
    duration_seconds    INTEGER,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_videos_product_id ON product_videos(product_id);

-- ─────────────────────────────────────────
-- TABLE: product_views
-- ✅ FIXED: Removed NOW() from partial index predicate
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_views (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    viewer_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_views_product_id ON product_views(product_id);
CREATE INDEX IF NOT EXISTS idx_product_views_created_at ON product_views(created_at DESC);

-- ✅ FIXED: Removed the partial index with NOW() — was causing 42P17
-- Use a regular index instead — PostgreSQL query planner handles date filtering
CREATE INDEX IF NOT EXISTS idx_product_views_product_created
    ON product_views(product_id, created_at DESC);

-- ─────────────────────────────────────────
-- TABLE: favorites
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_product_id ON favorites(product_id);
CREATE INDEX IF NOT EXISTS idx_favorites_created_at ON favorites(user_id, created_at DESC);

-- ─────────────────────────────────────────
-- TABLE: store_followers
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_followers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(follower_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_store_followers_follower_id ON store_followers(follower_id);
CREATE INDEX IF NOT EXISTS idx_store_followers_store_id ON store_followers(store_id);

-- ─────────────────────────────────────────
-- TABLE: conversations
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id              UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    buyer_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status                  VARCHAR(20) DEFAULT 'active'
                            CHECK (status IN ('active', 'archived', 'blocked', 'completed')),
    last_message_at         TIMESTAMPTZ,
    last_message_preview    TEXT,
    buyer_unread_count      INTEGER DEFAULT 0,
    seller_unread_count     INTEGER DEFAULT 0,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(product_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_buyer_id ON conversations(buyer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_seller_id ON conversations(seller_id);
CREATE INDEX IF NOT EXISTS idx_conversations_product_id ON conversations(product_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message
    ON conversations(last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);

-- ✅ FIXED: Partial index with string literal is fine (immutable comparison)
CREATE INDEX IF NOT EXISTS idx_conversations_user_inbox
    ON conversations(buyer_id, last_message_at DESC)
    WHERE status != 'archived';

CREATE INDEX IF NOT EXISTS idx_conversations_seller_inbox
    ON conversations(seller_id, last_message_at DESC)
    WHERE status != 'archived';

-- ─────────────────────────────────────────
-- TABLE: messages
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content             TEXT NOT NULL,
    content_type        VARCHAR(20) DEFAULT 'text'
                        CHECK (content_type IN ('text', 'system')),
    is_read             BOOLEAN DEFAULT FALSE,
    read_at             TIMESTAMPTZ,
    is_deleted          BOOLEAN DEFAULT FALSE,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread
    ON messages(conversation_id, is_read)
    WHERE is_read = FALSE AND is_deleted = FALSE;

-- ─────────────────────────────────────────
-- TABLE: qr_transactions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    seller_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    buyer_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash          VARCHAR(64) UNIQUE NOT NULL,
    status              VARCHAR(20) DEFAULT 'pending'
                        CHECK (status IN ('pending', 'scanned', 'expired', 'cancelled')),
    generated_at        TIMESTAMPTZ DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    scanned_at          TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    ip_address          INET,
    device_fingerprint  TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_product_id ON qr_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_qr_seller_id ON qr_transactions(seller_id);
CREATE INDEX IF NOT EXISTS idx_qr_buyer_id ON qr_transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_qr_token_hash ON qr_transactions(token_hash);
CREATE INDEX IF NOT EXISTS idx_qr_status ON qr_transactions(status);
CREATE INDEX IF NOT EXISTS idx_qr_pending_expires
    ON qr_transactions(expires_at) WHERE status = 'pending';

-- ─────────────────────────────────────────
-- TABLE: reviews
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qr_transaction_id       UUID NOT NULL REFERENCES qr_transactions(id) ON DELETE CASCADE,
    product_id              UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    reviewer_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewee_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_type           VARCHAR(10) NOT NULL
                            CHECK (reviewer_type IN ('buyer', 'seller')),
    rating                  SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment                 TEXT,
    tag_friendly            BOOLEAN DEFAULT FALSE,
    tag_fast                BOOLEAN DEFAULT FALSE,
    tag_accurate            BOOLEAN DEFAULT FALSE,
    tag_great_comm          BOOLEAN DEFAULT FALSE,
    tag_would_buy_again     BOOLEAN DEFAULT FALSE,
    tag_would_sell_again    BOOLEAN DEFAULT FALSE,
    is_visible              BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(qr_transaction_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_id ON reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id ON reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_qr_transaction ON reviews(qr_transaction_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(reviewee_id, rating);
CREATE INDEX IF NOT EXISTS idx_reviews_visible
    ON reviews(reviewee_id, is_visible, created_at DESC)
    WHERE is_visible = TRUE;

-- ─────────────────────────────────────────
-- TABLE: notifications
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(50) NOT NULL
                CHECK (type IN (
                    'new_message', 'new_follower', 'price_update',
                    'product_sold', 'review_received', 'admin_message',
                    'qr_generated', 'badge_earned', 'report_resolved'
                )),
    title       VARCHAR(200),
    body        TEXT,
    data        JSONB,
    is_read     BOOLEAN DEFAULT FALSE,
    read_at     TIMESTAMPTZ,
    fcm_sent    BOOLEAN DEFAULT FALSE,
    fcm_sent_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON notifications(user_id, created_at DESC);

-- ─────────────────────────────────────────
-- TABLE: reports
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type         VARCHAR(20) NOT NULL
                        CHECK (target_type IN ('user', 'product', 'store')),
    target_id           UUID NOT NULL,
    reason              VARCHAR(50) NOT NULL
                        CHECK (reason IN ('spam', 'counterfeit', 'inappropriate', 'scam', 'harassment', 'other')),
    description         TEXT,
    status              VARCHAR(20) DEFAULT 'pending'
                        CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
    resolved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at         TIMESTAMPTZ,
    resolution_note     TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_pending
    ON reports(status, created_at DESC) WHERE status = 'pending';

-- ─────────────────────────────────────────
-- TABLE: admin_logs
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id   UUID,
    metadata    JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON admin_logs(target_type, target_id);

-- ─────────────────────────────────────────
-- TABLE: search_history
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    query           VARCHAR(500) NOT NULL,
    result_count    INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id);
CREATE INDEX IF NOT EXISTS idx_search_history_created_at
    ON search_history(user_id, created_at DESC);

-- ─────────────────────────────────────────
-- FUTURE-READY TABLES (Phase 2 — locked)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            VARCHAR(50),
    external_account_id TEXT,
    is_verified         BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seller_wallets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance     DECIMAL(12, 2) DEFAULT 0.00,
    currency    VARCHAR(3) DEFAULT 'USD',
    is_active   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS escrow_transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
    buyer_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    seller_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    amount      DECIMAL(12, 2),
    currency    VARCHAR(3) DEFAULT 'USD',
    status      VARCHAR(20) DEFAULT 'inactive',
    is_active   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID REFERENCES products(id) ON DELETE SET NULL,
    buyer_id            UUID REFERENCES users(id) ON DELETE SET NULL,
    seller_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    qr_transaction_id   UUID REFERENCES qr_transactions(id) ON DELETE SET NULL,
    status              VARCHAR(20) DEFAULT 'inactive',
    total_amount        DECIMAL(12, 2),
    is_active           BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipping_addresses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    label           VARCHAR(50),
    address_line1   TEXT,
    address_line2   TEXT,
    city            VARCHAR(100),
    state           VARCHAR(100),
    country         VARCHAR(100),
    postal_code     VARCHAR(20),
    is_default      BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
    type        VARCHAR(50),
    amount      DECIMAL(12, 2),
    currency    VARCHAR(3) DEFAULT 'USD',
    is_active   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);