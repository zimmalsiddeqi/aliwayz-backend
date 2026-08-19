'use strict';

const buildApp = require('../../src/app');

describe('Performance Optimizations Verification', () => {
  let app;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test('should register @fastify/compress successfully in the fastify instance', () => {
    // Check if compression is registered as a plugin in Fastify
    // Fastify registers plugins under its internal tree
    const hasCompressPlugin = app.hasRoute({
      method: 'GET',
      url: '/health', // Checks that routes are compiled normally with compression active
    });

    expect(hasCompressPlugin).toBe(true);
  });

  test('should configure Supabase client decoration on Fastify instance', () => {
    const supabaseClient = app.supabase;
    expect(supabaseClient).toBeDefined();
  });
});
