'use strict';

const fp = require('fastify-plugin');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const ChatGateway = require('../modules/chat/chat.gateway');
const logger = require('../shared/utils/logger');
const redisConfig = require('../config/redis.config');
const Redis = require('ioredis');

async function socketPlugin(fastify) {
  // Create Socket.io server
  const io = new Server(fastify.server, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
        : ['http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 10000,
    maxHttpBufferSize: 1e6,
    transports: ['websocket', 'polling'],
  });

  // ─────────────────────────────────────────
  // Redis Adapter — create fresh connections
  // Do NOT duplicate the existing client
  // Create two brand new Redis connections
  // specifically for Socket.io pub/sub
  // ─────────────────────────────────────────
  try {
    const redisOptions = {
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password || undefined,
      db: redisConfig.db,
      lazyConnect: true,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      // No keyPrefix on pub/sub clients
      // Socket.io adapter manages its own namespacing
    };

    const pubClient = new Redis(redisOptions);
    const subClient = new Redis(redisOptions);

    // Connect both clients
    await Promise.all([
      pubClient.connect(),
      subClient.connect(),
    ]);

    // Verify both are connected
    const [pubPong, subPong] = await Promise.all([
      pubClient.ping(),
      subClient.ping(),
    ]);

    if (pubPong !== 'PONG' || subPong !== 'PONG') {
      throw new Error('Redis pub/sub clients did not respond to ping');
    }

    io.adapter(createAdapter(pubClient, subClient));

    logger.info('✅ Socket.io Redis adapter connected');

    fastify.addHook('onClose', async () => {
      await pubClient.quit();
      await subClient.quit();
    });
  } catch (err) {
    logger.warn(
      { err: err.message },
      '⚠️  Socket.io Redis adapter failed — single instance mode (OK for development)'
    );
  }

  // ─────────────────────────────────────────
  // Initialize Chat Gateway
  // ─────────────────────────────────────────
  const chatGateway = new ChatGateway(
    io,
    fastify.supabase,
    fastify.redis,
    fastify
  );

  chatGateway.initialize();

  // Decorate fastify instance
  fastify.decorate('io', io);
  fastify.decorate('chatGateway', chatGateway);

  fastify.addHook('onClose', async () => {
    io.close();
    logger.info('Socket.io server closed');
  });

  logger.info('✅ Socket.io server initialized');
}

module.exports = fp(socketPlugin, {
  name: 'socket-plugin',
  dependencies: ['redis-plugin', 'supabase-plugin'],
});