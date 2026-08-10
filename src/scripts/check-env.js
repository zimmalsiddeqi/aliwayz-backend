'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function checkEnvironment() {
  console.log('\n🔍 Checking environment configuration...\n');

  // ── Check required vars ──────────────────────────────────────────
  const required = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
    QR_SECRET_KEY: process.env.QR_SECRET_KEY,
    REDIS_HOST: process.env.REDIS_HOST,
  };

  let hasErrors = false;

  for (const [key, value] of Object.entries(required)) {
    if (!value?.trim()) {
      console.error(`❌ MISSING: ${key}`);
      hasErrors = true;
    } else {
      const displayValue =
        key.includes('KEY') || key.includes('SECRET')
          ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
          : value;
      console.log(`✅ ${key} = ${displayValue}`);
    }
  }

  // ── Check Supabase URL format ────────────────────────────────────
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();

  if (supabaseUrl) {
    if (!supabaseUrl.startsWith('https://')) {
      console.error('❌ SUPABASE_URL must start with https://');
      hasErrors = true;
    }
    if (supabaseUrl.endsWith('/')) {
      console.error('❌ SUPABASE_URL must NOT end with a trailing slash /');
      hasErrors = true;
    }
    if (!supabaseUrl.includes('.supabase.co')) {
      console.error('❌ SUPABASE_URL does not look like a valid Supabase URL');
      hasErrors = true;
    }
  }

  // ── Check QR key length ──────────────────────────────────────────
  const qrKey = (process.env.QR_SECRET_KEY || '').trim();
  if (qrKey && qrKey.length < 16) {
    console.error(
      `❌ QR_SECRET_KEY is too short (${qrKey.length} chars, min 16)`
    );
    hasErrors = true;
  }

  if (hasErrors) {
    console.error('\n❌ Fix the above issues in your .env file\n');
    process.exit(1);
  }

  // ── Test Supabase connection ─────────────────────────────────────
  console.log('\n🔌 Testing Supabase connection...');

  const supabase = createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  try {
    // Test auth connection (always available)
    const { data, error } = await supabase.auth.getSession();

    if (error && error.status >= 500) {
      console.error('❌ Supabase connection FAILED:', error.message);
      console.error('   → Check your SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
      process.exit(1);
    }

    console.log('✅ Supabase connection: OK');

    // Test if tables exist
    const { error: tableError } = await supabase
      .from('users')
      .select('id')
      .limit(1);

    if (tableError) {
      if (tableError.code === 'PGRST116' || tableError.code === '42P01') {
        console.warn(
          '⚠️  Supabase connected but tables not found.',
          '\n   → Run database migrations first!'
        );
      } else if (tableError.code === 'PGRST125') {
        console.error(
          '❌ PGRST125: Invalid URL path.',
          '\n   → Your SUPABASE_URL likely has a trailing slash or wrong format'
        );
        process.exit(1);
      } else {
        console.warn('⚠️  Table check warning:', tableError.message);
      }
    } else {
      console.log('✅ Supabase tables: OK');
    }
  } catch (err) {
    console.error('❌ Supabase connection threw an error:', err.message);
    console.error(
      '   → Check your internet connection and Supabase project status'
    );
    process.exit(1);
  }

  // ── Test Redis ───────────────────────────────────────────────────
  console.log('\n🔌 Testing Redis connection...');

  const Redis = require('ioredis');
  const redis = new Redis({
    host: (process.env.REDIS_HOST || '127.0.0.1').trim(),
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong === 'PONG') {
      console.log('✅ Redis connection: OK');
    } else {
      console.warn('⚠️  Redis ping returned unexpected response:', pong);
    }
  } catch (err) {
    console.error('❌ Redis connection FAILED:', err.message);
    console.error('   → Is Redis running? Check REDIS_HOST and REDIS_PORT');
  } finally {
    redis.disconnect();
  }

  console.log('\n✅ Environment check complete!\n');
}

checkEnvironment().catch((err) => {
  console.error('Check script failed:', err);
  process.exit(1);
});