"use strict";

require("dotenv").config();

const Fastify = require("fastify");
const appConfig = require("./config/app.config");
const logger = require("./shared/utils/logger");
const requestLogger = require("./middleware/requestLogger");
const { errorResponse } = require("./shared/utils/responseFormatter");

const buildApp = async () => {
  const fastify = Fastify({
    logger: false,
    trustProxy: true,
    ajv: {
      customOptions: {
        removeAdditional: "all",
        useDefaults: true,
        coerceTypes: "array",
        allErrors: false,
      },
    },
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  // ─────────────────────────────────────────
  // Request Lifecycle Hooks
  // ─────────────────────────────────────────
  fastify.addHook("onRequest", requestLogger.onRequest);
  fastify.addHook("onResponse", requestLogger.onResponse);
  fastify.addHook("onError", requestLogger.onError);

  // ─────────────────────────────────────────
  // Security Headers
  // ─────────────────────────────────────────
  await fastify.register(require("@fastify/helmet"), {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  // ─────────────────────────────────────────
  // CORS — Replace existing registration
  // ─────────────────────────────────────────
  await fastify.register(require("@fastify/cors"), {
    origin: (origin, cb) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return cb(null, true);

      // In development — allow all localhost origins
      if (appConfig.isDevelopment) {
        if (
          origin.startsWith("http://localhost") ||
          origin.startsWith("http://127.0.0.1")
        ) {
          return cb(null, true);
        }
      }

      // In production — check allowedOrigins list
      if (appConfig.cors.allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      // Block unknown origins
      return cb(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Device-ID",
      "X-Device-Name",
      "x-device-id",
      "x-device-name",
    ],
    credentials: true,
    preflight: true,
  });

  // ─────────────────────────────────────────
  // Compression (gzip/brotli)
  // ─────────────────────────────────────────
  await fastify.register(require("@fastify/compress"), {
    global: true,
    threshold: 1024, // Compress responses larger than 1KB
  });

  // ─────────────────────────────────────────
  // Multipart (file uploads)
  // ─────────────────────────────────────────
  await fastify.register(require("@fastify/multipart"), {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB max
      files: 21, // 20 images + 1 video
    },
  });

  // ─────────────────────────────────────────
  // Core Plugins (order is critical)
  // ─────────────────────────────────────────
  await fastify.register(require("./plugins/supabase.plugin"));
  await fastify.register(require("./plugins/redis.plugin"));
  await fastify.register(require("./plugins/auth.plugin"));
  await fastify.register(require("./plugins/rateLimiter.plugin"));
  await fastify.register(require("./plugins/socket.plugin"));

  // ─────────────────────────────────────────
  // Health Check
  // ─────────────────────────────────────────
  fastify.get("/health", async (request, reply) => {
    let redisStatus = "ok";
    try {
      await fastify.redisClient.ping();
    } catch {
      redisStatus = "error";
    }

    let dbStatus = "ok";
    try {
      const { error } = await fastify.supabase
        .from("users")
        .select("id")
        .limit(1);
      if (error) dbStatus = "error";
    } catch {
      dbStatus = "error";
    }

    const status =
      redisStatus === "ok" && dbStatus === "ok" ? "ok" : "degraded";

    return reply.status(status === "ok" ? 200 : 503).send({
      status,
      timestamp: new Date().toISOString(),
      version: appConfig.apiVersion,
      services: {
        database: dbStatus,
        cache: redisStatus,
      },
    });
  });

  // ─────────────────────────────────────────
  // Versioned API Routes
  // ─────────────────────────────────────────
  await fastify.register(
    async (api) => {
      await api.register(require("./modules/auth/auth.routes"), {
        prefix: "/auth",
      });

      await api.register(require("./modules/users/user.routes"), {
        prefix: "/users",
      });

      await api.register(require("./modules/stores/store.routes"), {
        prefix: "/stores",
      });

      await api.register(require("./modules/products/product.routes"), {
        prefix: "/products",
      });

      await api.register(require("./modules/categories/category.routes"), {
        prefix: "/categories",
      });

      await api.register(require("./modules/search/search.routes"), {
        prefix: "/search",
      });

      await api.register(require("./modules/chat/chat.routes"), {
        prefix: "/conversations",
      });

      await api.register(require("./modules/qr/qr.routes"), {
        prefix: "/qr",
      });

      await api.register(require("./modules/reviews/review.routes"), {
        prefix: "/reviews",
      });

      await api.register(require("./modules/favorites/favorite.routes"), {
        prefix: "/favorites",
      });

      await api.register(require("./modules/followers/follower.routes"), {
        prefix: "/followers",
      });

      await api.register(
        require("./modules/notifications/notification.routes"),
        { prefix: "/notifications" },
      );

      await api.register(require("./modules/reports/report.routes"), {
        prefix: "/reports",
      });

      await api.register(require("./modules/badges/badge.routes"), {
        prefix: "/badges",
      });

      await api.register(require("./modules/admin/admin.routes"), {
        prefix: "/admin",
      });
      await api.register(require("./modules/feedback/feedback.routes"), {
        prefix: "/feedback",
      });
    },
    { prefix: `/api/${appConfig.apiVersion}` },
  );

  // ─────────────────────────────────────────
  // Global Error Handler
  // ─────────────────────────────────────────
  fastify.setErrorHandler(async (error, request, reply) => {
    // ── Always set CORS headers on errors ──────────────────
    // Prevents browser showing "CORS error" instead of real error
    const origin = request.headers.origin;
    if (origin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
    }

    // ── Fastify schema validation ───────────────────────────
    if (error.validation) {
      return reply.status(422).send({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: Array.isArray(error.validation) ? error.validation : [],
      });
    }

    // ── Our operational AppErrors ───────────────────────────
    if (error.isOperational) {
      return reply.status(error.statusCode).send({
        success: false,
        message: error.message,
        code: error.code || "APP_ERROR",
        errors: error.errors || null,
      });
    }

    // ── Rate limit ──────────────────────────────────────────
    if (error.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        message: "Too many requests. Please slow down.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    // ── Supabase / PostgreSQL errors ────────────────────────
    if (error.code === "23505") {
      return reply.status(409).send({
        success: false,
        message: "This record already exists",
        code: "DUPLICATE_ENTRY",
      });
    }

    if (error.code === "23503") {
      return reply.status(400).send({
        success: false,
        message: "Referenced resource does not exist",
        code: "FOREIGN_KEY_VIOLATION",
      });
    }

    if (error.code === "42501") {
      logger.error(
        { url: request.url, userId: request.user?.id },
        "RLS policy violation",
      );
      return reply.status(403).send({
        success: false,
        message: "Permission denied",
        code: "RLS_VIOLATION",
      });
    }

    // ── CORS errors (explicit) ──────────────────────────────
    if (error.message === "Not allowed by CORS") {
      return reply.status(403).send({
        success: false,
        message: `CORS: Origin ${request.headers.origin} is not allowed`,
        code: "CORS_BLOCKED",
      });
    }

    // ── Unexpected 500 errors ───────────────────────────────
    const logBody = request.body ? { ...request.body } : undefined;
    if (logBody) {
      const sensitiveKeys = ['password', 'token', 'otp', 'code', 'refresh_token', 'accessToken', 'refreshToken'];
      for (const key of sensitiveKeys) {
        if (key in logBody) {
          logBody[key] = '[REDACTED]';
        }
      }
    }

    logger.error(
      {
        err: {
          message: error.message,
          code: error.code,
          stack: error.stack,
        },
        url: request.url,
        method: request.method,
        userId: request.user?.id || "guest",
        body: logBody,
      },
      "Unhandled server error",
    );

    return reply.status(500).send({
      success: false,
      message: appConfig.isProduction
        ? "Internal server error"
        : error.message || "Unknown server error",
      code: "INTERNAL_SERVER_ERROR",
      // Include stack in development for debugging
      ...(appConfig.isDevelopment && { stack: error.stack }),
    });
  });
  // ─────────────────────────────────────────
  // 404 Handler
  // ─────────────────────────────────────────
  fastify.setNotFoundHandler(async (request, reply) => {
    return reply
      .status(404)
      .send(
        errorResponse(
          `Route ${request.method} ${request.url} not found`,
          "ROUTE_NOT_FOUND",
        ),
      );
  });

  return fastify;
};

module.exports = buildApp;
