'use strict';

const CACHE_KEYS = Object.freeze({
  // Feed caches
  TRENDING_FEED: 'feed:trending',
  RECENT_FEED: 'feed:recent',
  NEARBY_FEED: (geohash) => `feed:nearby:${geohash}`,
  RECOMMENDED_FEED: (userId) => `feed:recommended:${userId}`,

  // Entity caches
  PRODUCT: (id) => `product:${id}`,
  STORE: (slug) => `store:${slug}`,
  USER_PROFILE: (username) => `user:profile:${username}`,
  CATEGORIES_TREE: 'categories:tree',
  POPULAR_SEARCHES: 'search:popular',

  // Badge caches
  USER_BADGES: (userId) => `user:badges:${userId}`,
  BADGE_DEFINITIONS: 'badges:definitions',

  // QR tokens
  QR_TOKEN: (hash) => `qr:token:${hash}`,

  // Rate limiting
  RATE_LIMIT: (ip, route) => `rate:${ip}:${route}`,

  // Online presence
  USER_ONLINE: (userId) => `presence:${userId}`,
  CONVERSATION_MEMBERS: (convId) => `conv:members:${convId}`,
});

const CACHE_TTL = Object.freeze({
  TRENDING_FEED: 300,        // 5 minutes
  RECENT_FEED: 60,           // 1 minute
  NEARBY_FEED: 600,          // 10 minutes
  RECOMMENDED_FEED: 300,     // 5 minutes
  PRODUCT: 120,              // 2 minutes
  STORE: 300,                // 5 minutes
  USER_PROFILE: 300,         // 5 minutes
  CATEGORIES_TREE: 3600,     // 1 hour
  POPULAR_SEARCHES: 1800,    // 30 minutes
  USER_BADGES: 300,          // 5 minutes
  BADGE_DEFINITIONS: 3600,   // 1 hour
  USER_ONLINE: 30,           // 30 seconds (heartbeat)
});

module.exports = { CACHE_KEYS, CACHE_TTL };