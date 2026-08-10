'use strict';

require('dotenv').config();

// ─────────────────────────────────────────
// Validate required env vars at startup
// Fail fast with clear error messages
// ─────────────────────────────────────────
const required = [
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'QR_SECRET_KEY',
];

const missing = required.filter((key) => !process.env[key]?.trim());

if (missing.length > 0) {
  console.error('\n❌ FATAL: Missing required environment variables:');
  missing.forEach((key) => console.error(`   - ${key}`));
  console.error('\n📄 Copy .env.example to .env and fill in all values\n');
  process.exit(1);
}

// ─────────────────────────────────────────
// Validate QR secret key length (AES-256 needs 32 chars)
// ─────────────────────────────────────────
const qrKey = (process.env.QR_SECRET_KEY || '').trim();
if (qrKey.length < 16) {
  console.error(
    '\n❌ FATAL: QR_SECRET_KEY must be at least 16 characters long\n'
  );
  process.exit(1);
}

const appConfig = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  apiVersion: (process.env.API_VERSION || 'v1').trim(),
  appName: (process.env.APP_NAME || 'Marketplace API').trim(),
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',

  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
      : ['http://localhost:3000'],
  },

  jwt: {
    secret: process.env.JWT_SECRET.trim(),
    accessExpiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m').trim(),
    refreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d').trim(),
  },

  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  },

  qr: {
    secretKey: qrKey,
    expiryMinutes: parseInt(process.env.QR_EXPIRY_MINUTES, 10) || 10,
  },

  cdn: {
    baseUrl: (process.env.CDN_BASE_URL || '').trim(),
  },

  storage: {
    bucket: (process.env.SUPABASE_STORAGE_BUCKET || 'marketplace-media').trim(),
  },
});

module.exports = appConfig;