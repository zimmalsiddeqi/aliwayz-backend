'use strict';

require('dotenv').config();

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
  console.log('Running migration 013: adding thumbnail columns to product_images...');

  const sql = `
    ALTER TABLE product_images
    ADD COLUMN IF NOT EXISTS thumbnail_storage_url TEXT,
    ADD COLUMN IF NOT EXISTS thumbnail_cdn_url TEXT;
  `;

  const r = await runSQL(sql);
  console.log('Status:', r.status);
  console.log('Body:', JSON.stringify(r.body));

  if (r.status === 200 || r.status === 204) {
    console.log('✅ Migration 013 applied successfully');
  } else {
    console.error('❌ Migration 013 failed');
    process.exit(1);
  }
}

main().catch(console.error);
