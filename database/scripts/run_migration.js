'use strict';

/**
 * Migration runner - runs pending SQL migrations against Supabase
 * using the service role key via the @supabase/supabase-js client
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Run raw SQL via Supabase pg REST protocol
 * Supabase exposes a /sql endpoint for service role.
 */
async function runSQL(sql) {
  const url  = process.env.SUPABASE_URL + '/rest/v1/';
  const https = require('https');
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return new Promise((resolve, reject) => {
    const ref = process.env.SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1];
    const body = JSON.stringify({ query: sql });

    const options = {
      hostname: ref + '.supabase.co',
      path:     '/pg/query',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  'Bearer ' + token,
        'apikey':         token,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Running migration 009...');

  // Try Supabase /pg/query endpoint
  const r = await runSQL(
    'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();'
  );
  console.log('Status:', r.status);
  console.log('Body:', JSON.stringify(r.body).substring(0, 300));

  if (r.status === 200 || r.status === 204) {
    console.log('✅ Migration 009 applied successfully');
  } else {
    console.log('⚠️  Direct SQL failed. Trying alternate approach...');

    // Create an RPC function first, then call it
    const createFn = await runSQL(`
      CREATE OR REPLACE FUNCTION _migrate_add_updated_at_to_notifications()
      RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
      END;
      $$;
    `);
    console.log('Create fn status:', createFn.status, JSON.stringify(createFn.body).substring(0, 200));

    if (createFn.status === 200 || createFn.status === 204) {
      const call = await supabase.rpc('_migrate_add_updated_at_to_notifications');
      console.log('RPC result:', JSON.stringify(call.error));
    }
  }
}

main().catch(console.error);
