'use strict';

const fp = require('fastify-plugin');
const { createClient } = require('@supabase/supabase-js');
const supabaseConfig = require('../config/supabase.config');
const logger = require('../shared/utils/logger');

async function supabasePlugin(fastify) {
  if (!supabaseConfig.url || !supabaseConfig.serviceRoleKey) {
    throw new Error(
      'FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env'
    );
  }

  if (!supabaseConfig.url.startsWith('https://')) {
    throw new Error(
      `FATAL: SUPABASE_URL invalid: "${supabaseConfig.url}"`
    );
  }

  // ─────────────────────────────────────────
  // Service role client
  // serviceRoleKey bypasses RLS automatically
  // ─────────────────────────────────────────
  const supabase = createClient(
    supabaseConfig.url,
    supabaseConfig.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      db: {
        schema: 'public',
      },
      global: {
        headers: {
          // Explicitly set role to service_role
          'x-supabase-role': 'service_role',
        },
      },
    }
  );

  // Test connection
  try {
    const { error } = await supabase.rpc('version');
    if (error && error.code !== 'PGRST202') {
      const { error: authError } = await supabase.auth.getSession();
      if (authError && authError.status >= 500) {
        throw new Error('Supabase connection failed');
      }
    }
    logger.info('Supabase connected successfully');
  } catch (err) {
    if (err.message === 'Supabase connection failed') throw err;
    logger.error({ err: err.message }, 'Supabase connection test error');
    throw new Error('Supabase connection failed');
  }

  fastify.decorate('supabase', supabase);

  fastify.addHook('onClose', async () => {
    logger.info('Supabase client closed');
  });
}

module.exports = fp(supabasePlugin, {
  name: 'supabase-plugin',
});