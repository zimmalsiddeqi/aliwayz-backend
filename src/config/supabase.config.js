'use strict';

require('dotenv').config();

// Trim whitespace from env vars — common cause of connection failures
const supabaseConfig = Object.freeze({
  url: (process.env.SUPABASE_URL || '').trim(),
  anonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
  serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  jwtSecret: (process.env.SUPABASE_JWT_SECRET || '').trim(),
  storageBucket: (process.env.SUPABASE_STORAGE_BUCKET || 'marketplace-media').trim(),
});

module.exports = supabaseConfig;