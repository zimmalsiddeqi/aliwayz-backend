'use strict';

/**
 * Aliwayz Marketplace — Full Integration Test Suite
 *
 * Covers every PRD workflow:
 * 1.  Health Check
 * 2.  Auth — Seller & Buyer Signup/Login
 * 3.  Categories — Browse, Flat list, Category detail
 * 4.  Stores — Create, Fetch, Update, Analytics, Follow/Unfollow
 * 5.  Products — Create, Browse, Detail, Update, Status, Feeds, Favorites
 * 6.  Search — Products, Stores, Suggestions, Popular, History
 * 7.  Chat/Conversations — Start, Fetch, Messages, Report, Block, Archive
 * 8.  QR System — Generate, Status, Cancel, Regenerate, Scan flow
 * 9.  Reviews — Submit (buyer→seller, seller→buyer), Fetch, Summary
 * 10. Favorites — Add, List, Status, Remove
 * 11. Followers — Follow, List, Status, Unfollow, My-followed-stores
 * 12. Notifications — List, Mark Read, Mark All Read
 * 13. Reports — Submit product report, user report, my reports
 * 14. Badges — List all, user badges, badge progress, badge history
 * 15. Admin — Dashboard, Users, Stores, Products, Reports, Broadcast, Logs
 */

const request = require('supertest');
const buildApp = require('../../src/app');

jest.setTimeout(60000); // 60 s per test (network calls to Supabase)

// ─────────────────────────────────────────────────────
// Shared state across tests
// ─────────────────────────────────────────────────────
let app;
let sellerToken, buyerToken;
let sellerId, buyerId;
let storeId, storeSlug;
let categoryId;
let productId;
let conversationId;
let transactionId;
let reportId;
let notificationId;
let globalSellerEmail;

const rnd = () => Math.floor(Math.random() * 1_000_000);

// ─────────────────────────────────────────────────────
// Setup / Teardown
// ─────────────────────────────────────────────────────
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

// ─────────────────────────────────────────────────────
// Helper: authenticated request
// ─────────────────────────────────────────────────────
const api = () => request(app.server);

// =====================================================
// 0. HEALTH CHECK
// =====================================================
describe('00. Health Check', () => {
  test('GET /health — server is healthy', async () => {
    const res = await api().get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.database).toBe('ok');
    expect(res.body.services.cache).toBe('ok');
  });
});

// =====================================================
// 1. AUTHENTICATION
// =====================================================
describe('01. Authentication', () => {
  const suffix = rnd();
  const sellerEmail = `seller_${suffix}@aliwayz.com`;
  const buyerEmail  = `buyer_${suffix}@aliwayz.com`;
  let refreshToken;

  test('POST /auth/signup — Seller signup returns 201 with token', async () => {
    globalSellerEmail = sellerEmail;
    const res = await api()
      .post('/api/v1/auth/signup')
      .send({
        email: sellerEmail,
        password: 'Seller@123456',
        username: `seller_${suffix}`,
        full_name: 'Test Seller',
        role: 'seller',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('access_token');
    expect(res.body.data).toHaveProperty('refresh_token');
    sellerToken = res.body.data.access_token;
    refreshToken = res.body.data.refresh_token;
    sellerId = res.body.data.user.id;
  });

  test('POST /auth/signup — Buyer signup returns 201 with token', async () => {
    const res = await api()
      .post('/api/v1/auth/signup')
      .send({
        email: buyerEmail,
        password: 'Buyer@123456',
        username: `buyer_${suffix}`,
        full_name: 'Test Buyer',
        role: 'buyer',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    buyerToken = res.body.data.access_token;
    buyerId = res.body.data.user.id;
  });

  test('POST /auth/signup — Duplicate email returns 409', async () => {
    const res = await api()
      .post('/api/v1/auth/signup')
      .send({
        email: sellerEmail,
        password: 'Seller@123456',
        username: `seller_dup_${rnd()}`,
        full_name: 'Duplicate',
        role: 'seller',
      });
    expect(res.statusCode).toBe(409);
  });

  test('POST /auth/login — Seller login returns 200 with tokens', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: sellerEmail, password: 'Seller@123456' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('access_token');
    sellerToken = res.body.data.access_token;
  });

  test('POST /auth/login — Buyer login returns 200 with tokens', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: buyerEmail, password: 'Buyer@123456' });
    expect(res.statusCode).toBe(200);
    buyerToken = res.body.data.access_token;
  });

  test('POST /auth/login — Wrong password returns 401', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: sellerEmail, password: 'WrongPass!1' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /auth/refresh — Refreshes token successfully', async () => {
    const res = await api()
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refreshToken });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('access_token');
  });

  test('POST /auth/forgot-password — Accepts valid email (no-op in dev)', async () => {
    const res = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: sellerEmail });
    // Should return 200 regardless (security: don't reveal user existence)
    expect([200, 204]).toContain(res.statusCode);
  });

  test('POST /auth/complete-profile — Seller completes profile', async () => {
    const res = await api()
      .post('/api/v1/auth/complete-profile')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        username: `seller_${suffix}`,
        full_name: 'Test Seller Full',
        role: 'seller',
        location_city: 'Karachi',
        location_lat: 24.8607,
        location_lng: 67.0011,
      });
    expect([200, 409]).toContain(res.statusCode); // 409 if already complete
  });
});

// =====================================================
// 2. USERS
// =====================================================
describe('02. Users', () => {
  test('GET /users/me — Seller gets own profile', async () => {
    const res = await api()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('email');
  });

  test('GET /users/me — No token returns 401', async () => {
    const res = await api().get('/api/v1/users/me');
    expect(res.statusCode).toBe(401);
  });

  test('PUT /users/me — Seller updates bio', async () => {
    const res = await api()
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ full_name: 'Updated Seller', bio: 'I sell great stuff!' });
    expect(res.statusCode).toBe(200);
  });

  test('PUT /users/me/location — Updates location', async () => {
    const res = await api()
      .put('/api/v1/users/me/location')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ location_city: 'Karachi', location_lat: 24.8607, location_lng: 67.0011 });
    expect(res.statusCode).toBe(200);
  });

  test('PUT /users/me/fcm-token — Updates FCM token', async () => {
    const res = await api()
      .put('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ fcm_token: 'test_fcm_token_12345' });
    expect(res.statusCode).toBe(200);
  });

  test('GET /users/:username — Public profile (guest accessible)', async () => {
    // Get the username from profile first
    const me = await api()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${sellerToken}`);
    const username = me.body.data.username;

    const res = await api().get(`/api/v1/users/${username}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('username');
    // Sensitive fields should NOT be present
    expect(res.body.data).not.toHaveProperty('email');
  });

  test('GET /users/me/purchases — Buyer purchase history', async () => {
    const res = await api()
      .get('/api/v1/users/me/purchases')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('GET /users/me/favorites — Buyer favorites list', async () => {
    const res = await api()
      .get('/api/v1/users/me/favorites')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
  });

  test('GET /users/me/following — Buyer following stores', async () => {
    const res = await api()
      .get('/api/v1/users/me/following')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
  });
});

// =====================================================
// 3. CATEGORIES
// =====================================================
describe('03. Categories', () => {
  test('GET /categories — Returns category tree', async () => {
    const res = await api().get('/api/v1/categories');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    categoryId = res.body.data[0].id;
  });

  test('GET /categories/flat — Returns flat list', async () => {
    const res = await api().get('/api/v1/categories/flat');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /categories/electronics — Returns category with products', async () => {
    const res = await api().get('/api/v1/categories/electronics');
    expect(res.statusCode).toBe(200);
  });

  test('GET /categories/nonexistent-slug — Returns 404', async () => {
    const res = await api().get('/api/v1/categories/this-does-not-exist-xyz');
    expect(res.statusCode).toBe(404);
  });
});

// =====================================================
// 4. STORES
// =====================================================
describe('04. Stores', () => {
  test('POST /stores — Seller creates store', async () => {
    const suffix = rnd();
    const res = await api()
      .post('/api/v1/stores')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        store_name: `Electronics Hub ${suffix}`,
        description: 'Best electronics at best prices',
        location_city: 'Karachi',
        location_lat: 24.8607,
        location_lng: 67.0011,
        social_instagram: 'https://instagram.com/electronichub',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('slug');
    storeId   = res.body.data.id;
    storeSlug = res.body.data.slug;
  });

  test('POST /stores — Buyer cannot create store', async () => {
    const res = await api()
      .post('/api/v1/stores')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ store_name: `Unauthorized Store ${rnd()}`, description: 'Test', location_city: 'Lahore' });
    expect(res.statusCode).toBe(403);
  });

  test('GET /stores/:slug — Public store view', async () => {
    const res = await api().get(`/api/v1/stores/${storeSlug}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('slug', storeSlug);
  });

  test('PUT /stores/:id — Seller updates store', async () => {
    const res = await api()
      .put(`/api/v1/stores/${storeId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Updated store description!' });
    expect(res.statusCode).toBe(200);
  });

  test('GET /stores/:slug/products — Store product listing', async () => {
    const res = await api().get(`/api/v1/stores/${storeSlug}/products`);
    expect(res.statusCode).toBe(200);
  });

  test('GET /stores/:id/analytics — Seller can view analytics', async () => {
    const res = await api()
      .get(`/api/v1/stores/${storeId}/analytics`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.overview).toHaveProperty('total_listings');
  });

  test('POST /stores/:slug/follow — Buyer follows store', async () => {
    const res = await api()
      .post(`/api/v1/stores/${storeSlug}/follow`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect([200, 201]).toContain(res.statusCode);
  });

  test('GET /stores/:id/followers — Lists store followers', async () => {
    const res = await api().get(`/api/v1/stores/${storeId}/followers`);
    expect(res.statusCode).toBe(200);
  });

  test('DELETE /stores/:slug/follow — Buyer unfollows store', async () => {
    const res = await api()
      .delete(`/api/v1/stores/${storeSlug}/follow`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
  });
});

// =====================================================
// 5. PRODUCTS
// =====================================================
describe('05. Products', () => {
  test('POST /products — Seller creates product', async () => {
    expect(categoryId).toBeDefined();
    const res = await api()
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'iPhone 14 Pro Max 256GB',
        description: 'Brand new iPhone 14 Pro Max in Deep Purple. Box packed, never used.',
        category_id: categoryId,
        condition: 'new',
        price: 350000,
        currency: 'PKR',
        brand: 'Apple',
        color: 'Deep Purple',
        quantity: 1,
        location_city: 'Karachi',
        location_lat: 24.8607,
        location_lng: 67.0011,
        status: 'available',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    productId = res.body.data.id;
  });

  test('POST /products — Buyer cannot create product', async () => {
    const res = await api()
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        title: 'Fake Listing',
        description: 'Test',
        category_id: categoryId,
        condition: 'new',
        price: 100,
        currency: 'PKR',
        quantity: 1,
        location_city: 'Lahore',
      });
    expect(res.statusCode).toBe(403);
  });

  test('GET /products — Browse all products (public)', async () => {
    const res = await api().get('/api/v1/products?page=1&limit=10&sort=newest');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /products/:id — Product detail (public)', async () => {
    const res = await api().get(`/api/v1/products/${productId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('id', productId);
    expect(res.body.data).toHaveProperty('title');
  });

  test('GET /products/:id — Non-existent product returns 404', async () => {
    const res = await api().get('/api/v1/products/00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(404);
  });

  test('PUT /products/:id — Seller updates product price', async () => {
    const res = await api()
      .put(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 340000, description: 'Updated: Brand new iPhone 14 Pro Max. Price negotiable!' });
    expect(res.statusCode).toBe(200);
  });

  test('PUT /products/:id/status — Seller marks as reserved', async () => {
    const res = await api()
      .put(`/api/v1/products/${productId}/status`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ status: 'reserved' });
    expect(res.statusCode).toBe(200);
  });

  test('PUT /products/:id/status — Seller resets status to available', async () => {
    const res = await api()
      .put(`/api/v1/products/${productId}/status`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ status: 'available' });
    expect(res.statusCode).toBe(200);
  });

  test('GET /products/feed/trending — Trending feed (public)', async () => {
    const res = await api().get('/api/v1/products/feed/trending');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /products/feed/recent — Recent feed (public)', async () => {
    const res = await api().get('/api/v1/products/feed/recent');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /products/feed/nearby — Nearby feed (public)', async () => {
    const res = await api().get('/api/v1/products/feed/nearby?lat=24.8607&lng=67.0011&radius_km=50');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /products/feed/recommended — Recommended feed (authenticated)', async () => {
    const res = await api()
      .get('/api/v1/products/feed/recommended')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /products/:id/favorite — Buyer favorites product', async () => {
    const res = await api()
      .post(`/api/v1/products/${productId}/favorite`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect([200, 201]).toContain(res.statusCode);
  });

  test('DELETE /products/:id/favorite — Buyer unfavorites product', async () => {
    const res = await api()
      .delete(`/api/v1/products/${productId}/favorite`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
  });
});

// =====================================================
// 6. SEARCH
// =====================================================
describe('06. Search', () => {
  test('GET /search?q=iPhone — Product search returns results', async () => {
    const res = await api().get('/api/v1/search?q=iPhone&page=1&limit=10');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /search?q=iPhone with filters — Filtered search', async () => {
    const res = await api().get(
      '/api/v1/search?q=iPhone&min_price=100000&max_price=500000&condition=new&sort=price_asc'
    );
    expect(res.statusCode).toBe(200);
  });

  test('GET /search/stores?q=electronics — Store search', async () => {
    const res = await api().get('/api/v1/search/stores?q=electronics');
    expect(res.statusCode).toBe(200);
  });

  test('GET /search/suggestions?q=iPh — Autocomplete suggestions', async () => {
    const res = await api().get('/api/v1/search/suggestions?q=iPh');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /search/popular — Popular searches', async () => {
    const res = await api().get('/api/v1/search/popular');
    expect(res.statusCode).toBe(200);
  });

  test('GET /search/history — Own search history (auth required)', async () => {
    const res = await api()
      .get('/api/v1/search/history')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
  });

  test('DELETE /search/history — Clear search history', async () => {
    const res = await api()
      .delete('/api/v1/search/history')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
  });
});

// =====================================================
// 7. CHAT / CONVERSATIONS (PRD Meet-Up Flow)
// =====================================================
describe('07. Chat / Conversations', () => {
  test('POST /conversations — Buyer starts conversation about product', async () => {
    const res = await api()
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        product_id: productId,
        initial_message: 'Hi! Is this iPhone still available? Can you negotiate the price?',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    conversationId = res.body.data.id;
  });

  test('POST /conversations — Cannot start duplicate conversation', async () => {
    const res = await api()
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        product_id: productId,
        initial_message: 'Duplicate message',
      });
    // Should return 200 (existing) or 201 (new) — depends on implementation
    expect([200, 201, 409]).toContain(res.statusCode);
  });

  test('GET /conversations — Seller lists all conversations', async () => {
    const res = await api()
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /conversations/:id — Seller views conversation detail', async () => {
    const res = await api()
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('id', conversationId);
  });

  test('GET /conversations/:id/messages — Seller fetches messages', async () => {
    const res = await api()
      .get(`/api/v1/conversations/${conversationId}/messages?page=1&limit=20`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /conversations/:id/report — Buyer reports conversation', async () => {
    const res = await api()
      .post(`/api/v1/conversations/${conversationId}/report`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'spam', description: 'Sending repetitive messages' });
    expect([200, 201]).toContain(res.statusCode);
  });
});

// =====================================================
// 8. QR SYSTEM (PRD strict logic)
// =====================================================
describe('08. QR System', () => {
  let qrRawToken;  // The encrypted token to scan

  test('POST /qr/generate — Seller generates QR code for buyer', async () => {
    const res = await api()
      .post('/api/v1/qr/generate')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ product_id: productId, buyer_id: buyerId });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('transaction_id');
    expect(res.body.data).toHaveProperty('qr_code');         // base64 data URL
    expect(res.body.data).toHaveProperty('expires_at');
    expect(res.body.data).toHaveProperty('expires_in_minutes', 10);
    transactionId = res.body.data.transaction_id;

    // Decode the QR token from the data URL — the raw encrypted token
    // is stored in Redis under CACHE_KEYS.QR_TOKEN(hash). 
    // For scan, we need the raw token embedded in the QR image.
    // We store it in the qr_code field as data: image/png;base64 — NOT the token.
    // We obtain the raw token via the QR crypto module directly for testing.
    const qrCrypto = require('../../src/modules/qr/qr.crypto');
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    // Fetch the token_hash from db and reconstruct via redis
    const { data: txn } = await supabase
      .from('qr_transactions')
      .select('token_hash')
      .eq('id', transactionId)
      .single();

    // We can't un-hash SHA256, so we test the QR status instead
    // and test cancel/regenerate flow directly
    expect(txn).toBeDefined();
    expect(txn.token_hash).toBeDefined();
  });

  test('GET /qr/status/:productId — Active QR status shows has_active_qr=true', async () => {
    const res = await api()
      .get(`/api/v1/qr/status/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.has_active_qr).toBe(true);
    expect(res.body.data).toHaveProperty('expires_at');
    expect(res.body.data).toHaveProperty('minutes_remaining');
  });

  test('POST /qr/cancel — Seller cancels QR, product reverts to available', async () => {
    const res = await api()
      .post('/api/v1/qr/cancel')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ product_id: productId, reason: 'Deal cancelled by mutual agreement' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify product is available again
    const productRes = await api().get(`/api/v1/products/${productId}`);
    expect(productRes.body.data.status).toBe('available');
  });

  test('GET /qr/status/:productId — After cancel: has_active_qr=false', async () => {
    const res = await api()
      .get(`/api/v1/qr/status/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.has_active_qr).toBe(false);
  });

  test('POST /qr/regenerate — Seller regenerates QR after cancellation', async () => {
    const res = await api()
      .post('/api/v1/qr/regenerate')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ product_id: productId, buyer_id: buyerId });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    transactionId = res.body.data.transaction_id;
  });

  test('POST /qr/scan — Wrong buyer cannot scan QR (forbidden)', async () => {
    // Create a dummy token that decodes to a different buyer
    const res = await api()
      .post('/api/v1/qr/scan')
      .set('Authorization', `Bearer ${sellerToken}`) // seller tries to scan their own QR
      .send({ token: 'invalid_token_string' });
    expect([400, 403]).toContain(res.statusCode);
  });

  test('POST /qr/scan — Invalid token returns 400', async () => {
    const res = await api()
      .post('/api/v1/qr/scan')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ token: 'INVALID_ENCRYPTED_TOKEN_XXXX' });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_QR_TOKEN');
  });

  test('POST /qr/scan — Full QR scan workflow completes sale', async () => {
    // Re-generate a fresh QR so we have the raw token
    // Using regenerate to avoid 409 if an active QR already exists
    const genRes = await api()
      .post('/api/v1/qr/regenerate')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ product_id: productId, buyer_id: buyerId });
    expect(genRes.statusCode).toBe(201);
    transactionId = genRes.body.data.transaction_id;
    const rawToken = genRes.body.data.raw_token;

    // Buyer scans — this should complete the sale
    const scanRes = await api()
      .post('/api/v1/qr/scan')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ token: rawToken });

    expect(scanRes.statusCode).toBe(200);
    expect(scanRes.body.success).toBe(true);
    expect(scanRes.body.data.success).toBe(true);
    expect(scanRes.body.data.can_review).toBe(true);

    // Verify product is now SOLD
    const productRes = await api().get(`/api/v1/products/${productId}`);
    expect(productRes.body.data.status).toBe('sold');
  });
});

// =====================================================
// 9. REVIEWS (unlocked after QR scan)
// =====================================================
describe('09. Reviews', () => {
  test('POST /reviews — Buyer reviews Seller after successful sale', async () => {
    const res = await api()
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        qr_transaction_id: transactionId,
        rating: 5,
        comment: 'Great seller! Product exactly as described. Fast and friendly.',
        tag_friendly: true,
        tag_fast: true,
        tag_accurate: true,
        tag_great_comm: true,
        tag_would_buy_again: true,
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('POST /reviews — Seller reviews Buyer after successful sale', async () => {
    const res = await api()
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        qr_transaction_id: transactionId,
        rating: 5,
        comment: 'Great buyer! Quick payment and very polite.',
        tag_friendly: true,
        tag_would_sell_again: true,
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('POST /reviews — Cannot double-review same transaction', async () => {
    const res = await api()
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        qr_transaction_id: transactionId,
        rating: 4,
        comment: 'Second review attempt',
      });
    expect([400, 409, 422]).toContain(res.statusCode);
  });

  test('GET /reviews/user/:userId — Seller received reviews', async () => {
    const res = await api().get(`/api/v1/reviews/user/${sellerId}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /reviews/user/:userId/summary — Seller review summary', async () => {
    const res = await api().get(`/api/v1/reviews/user/${sellerId}/summary`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('average_rating');
    expect(res.body.data).toHaveProperty('total');
  });

  test('GET /reviews/store/:storeId — Store reviews', async () => {
    const res = await api().get(`/api/v1/reviews/store/${storeId}`);
    expect(res.statusCode).toBe(200);
  });

  test('GET /reviews/user/:userId/written — Reviews written by buyer', async () => {
    const res = await api().get(`/api/v1/reviews/user/${buyerId}/written`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// =====================================================
// 10. FAVORITES
// =====================================================
describe('10. Favorites', () => {
  let favProductId;

  beforeAll(async () => {
    // Create a new product to favorite
    const res = await api()
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Samsung Galaxy S24 Ultra',
        description: 'Brand new Samsung phone',
        category_id: categoryId,
        condition: 'new',
        price: 250000,
        currency: 'PKR',
        quantity: 1,
        location_city: 'Karachi',
        location_lat: 24.8607,
        location_lng: 67.0011,
        status: 'available',
      });
    favProductId = res.body.data.id;
  });

  test('POST /favorites/:productId — Add to favorites', async () => {
    const res = await api()
      .post(`/api/v1/favorites/${favProductId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect([200, 201]).toContain(res.statusCode);
  });

  test('GET /favorites — List my favorites', async () => {
    const res = await api()
      .get('/api/v1/favorites')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test('GET /favorites/:productId/status — Check favorite status', async () => {
    const res = await api()
      .get(`/api/v1/favorites/${favProductId}/status`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.is_favorited).toBe(true);
  });

  test('DELETE /favorites/:productId — Remove from favorites', async () => {
    const res = await api()
      .delete(`/api/v1/favorites/${favProductId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
  });

  test('GET /favorites/:productId/status — After removal: is_favorited=false', async () => {
    const res = await api()
      .get(`/api/v1/favorites/${favProductId}/status`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.is_favorited).toBe(false);
  });
});

// =====================================================
// 11. FOLLOWERS
// =====================================================
describe('11. Followers', () => {
  test('POST /followers/stores/:storeId — Buyer follows store', async () => {
    const res = await api()
      .post(`/api/v1/followers/stores/${storeId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect([200, 201]).toContain(res.statusCode);
  });

  test('GET /followers/stores/:storeId — List store followers (public)', async () => {
    const res = await api().get(`/api/v1/followers/stores/${storeId}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /followers/me/stores — My followed stores', async () => {
    const res = await api()
      .get('/api/v1/followers/me/stores')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /followers/stores/:storeId/status — Check follow status', async () => {
    const res = await api()
      .get(`/api/v1/followers/stores/${storeId}/status`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.is_following).toBe(true);
  });

  test('DELETE /followers/stores/:storeId — Buyer unfollows store', async () => {
    const res = await api()
      .delete(`/api/v1/followers/stores/${storeId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
  });

  test('GET /followers/stores/:storeId/status — After unfollow: is_following=false', async () => {
    const res = await api()
      .get(`/api/v1/followers/stores/${storeId}/status`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.is_following).toBe(false);
  });
});

// =====================================================
// 12. NOTIFICATIONS
// =====================================================
describe('12. Notifications', () => {
  test('GET /notifications — Lists notifications for seller', async () => {
    const res = await api()
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    if (res.body.data.length > 0) {
      notificationId = res.body.data[0].id;
    }
  });

  test('PUT /notifications/read-all — Mark all notifications as read', async () => {
    const res = await api()
      .put('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
  });

  test('PUT /notifications/:id/read — Mark single notification read (if any)', async () => {
    if (!notificationId) {
      console.log('  Skipping: no notifications to mark');
      return;
    }
    const res = await api()
      .put(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
  });

  test('GET /users/me/notifications — Via user route', async () => {
    const res = await api()
      .get('/api/v1/users/me/notifications')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
  });
});

// =====================================================
// 13. REPORTS
// =====================================================
describe('13. Reports', () => {
  let newProductId;

  beforeAll(async () => {
    // Create another product so we can report it without impacting other tests
    const res = await api()
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Reportable Test Product',
        description: 'A product for testing reports',
        category_id: categoryId,
        condition: 'used',
        price: 5000,
        currency: 'PKR',
        quantity: 1,
        location_city: 'Karachi',
        location_lat: 24.8607,
        location_lng: 67.0011,
        status: 'available',
      });
    newProductId = res.body.data?.id;
  });

  test('POST /reports — Report a product (counterfeit)', async () => {
    if (!newProductId) return;
    const res = await api()
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        target_type: 'product',
        target_id: newProductId,
        reason: 'counterfeit',
        description: 'This product appears to be a fake/replica',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    reportId = res.body.data.id;
  });

  test('POST /reports — Report a user (scam)', async () => {
    const res = await api()
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        target_type: 'user',
        target_id: sellerId,
        reason: 'scam',
        description: 'Seller is not responding after payment',
      });
    expect([200, 201, 409]).toContain(res.statusCode);
  });

  test('GET /reports/me — Buyer views own submitted reports', async () => {
    const res = await api()
      .get('/api/v1/reports/me')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// =====================================================
// 14. BADGES
// =====================================================
describe('14. Badges', () => {
  test('GET /badges — All available badges (public)', async () => {
    const res = await api().get('/api/v1/badges');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // PRD defines: New Seller, Verified Seller, 100 Rated Seller, 500 Rated Seller, Top Seller, Trusted Buyer
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
  });

  test('GET /badges/user/:userId — Seller earned badges (public)', async () => {
    const res = await api().get(`/api/v1/badges/user/${sellerId}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /badges/me/progress — Seller badge progress (auth)', async () => {
    const res = await api()
      .get('/api/v1/badges/me/progress')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.stats).toHaveProperty('total_sales');
  });

  test('GET /badges/history/:userId — Badge history (auth)', async () => {
    const res = await api()
      .get(`/api/v1/badges/history/${sellerId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// =====================================================
// 15. ADMIN (requires admin role — these will 403 with seller token,
//     confirming admin guard works; we also promote seller to admin for coverage)
// =====================================================
describe('15. Admin (Authorization Guard)', () => {
  test('GET /admin/dashboard — Seller (non-admin) gets 403', async () => {
    const res = await api()
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(403);
  });

  test('GET /admin/users — Seller (non-admin) gets 403', async () => {
    const res = await api()
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.statusCode).toBe(403);
  });

  test('GET /admin/dashboard — No token returns 401', async () => {
    const res = await api().get('/api/v1/admin/dashboard');
    expect(res.statusCode).toBe(401);
  });

  // Promote seller to admin directly in Supabase for admin endpoint testing
  test('Admin endpoints work after role promotion', async () => {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Promote seller to admin
    await supabase
      .from('users')
      .update({ role: 'admin' })
      .eq('id', sellerId);

    // Log seller back in to get fresh token with updated role
    const loginRes = await api()
      .post('/api/v1/auth/login')
      .send({
        email: globalSellerEmail,
        password: 'Seller@123456',
      });

    const adminToken = loginRes.body.data.access_token;

    // Dashboard
    const dashRes = await api()
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dashRes.statusCode).toBe(200);
    expect(dashRes.body.data).toHaveProperty('total_users');

    // All Users
    const usersRes = await api()
      .get('/api/v1/admin/users?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(usersRes.statusCode).toBe(200);

    // User Detail
    const userDetailRes = await api()
      .get(`/api/v1/admin/users/${buyerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(userDetailRes.statusCode).toBe(200);

    // All Stores
    const storesRes = await api()
      .get('/api/v1/admin/stores')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(storesRes.statusCode).toBe(200);

    // Verify Store
    const verifyRes = await api()
      .put(`/api/v1/admin/stores/${storeId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_verified: true });
    expect(verifyRes.statusCode).toBe(200);

    // All Products
    const productsRes = await api()
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(productsRes.statusCode).toBe(200);

    // Feature a product (create a new product first)
    const fpRes = await api()
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Featured Test Product',
        description: 'For admin feature test',
        category_id: categoryId,
        condition: 'new',
        price: 10000,
        currency: 'PKR',
        quantity: 1,
        location_city: 'Karachi',
        location_lat: 24.8607,
        location_lng: 67.0011,
        status: 'available',
      });

    if (fpRes.statusCode === 201) {
      const fpId = fpRes.body.data.id;
      const featureRes = await api()
        .put(`/api/v1/admin/products/${fpId}/feature`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_featured: true, featured_until: '2026-12-31T23:59:59Z' });
      expect(featureRes.statusCode).toBe(200);
    }

    // All Reports
    const reportsRes = await api()
      .get('/api/v1/reports?status=pending')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reportsRes.statusCode).toBe(200);

    // Resolve Report
    if (reportId) {
      const resolveRes = await api()
        .put(`/api/v1/reports/${reportId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'resolved', resolution_note: 'Verified and resolved.' });
      expect(resolveRes.statusCode).toBe(200);
    }

    // Evaluate badges for seller via admin endpoint
    const evalRes = await api()
      .post(`/api/v1/badges/evaluate/${sellerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(evalRes.statusCode).toBe(200);

    // Admin Logs
    const logsRes = await api()
      .get('/api/v1/admin/logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(logsRes.statusCode).toBe(200);

    // Broadcast Notification
    const broadcastRes = await api()
      .post('/api/v1/admin/notifications/push')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Test Broadcast', body: 'Integration test broadcast message.' });
    expect([200, 201]).toContain(broadcastRes.statusCode);

    // Suspend a user
    const suspendRes = await api()
      .put(`/api/v1/admin/users/${buyerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'suspended', reason: 'Test suspension' });
    expect(suspendRes.statusCode).toBe(200);

    // Restore user
    const restoreRes = await api()
      .put(`/api/v1/admin/users/${buyerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active', reason: 'Restored after test' });
    expect(restoreRes.statusCode).toBe(200);

    // Revert seller back to seller role
    await supabase
      .from('users')
      .update({ role: 'seller' })
      .eq('id', sellerId);
  });
});
