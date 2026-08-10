'use strict';

const AuthController = require('./auth.controller');
const { authenticate } = require('../../middleware/authenticate');
const { sanitizeInput } = require('../../middleware/sanitize');

async function authRoutes(fastify) {
  const ctrl = new AuthController(fastify);

  // Bind controller methods to preserve `this` context
  const signup = ctrl.signup.bind(ctrl);
  const login = ctrl.login.bind(ctrl);
  const googleOAuth = ctrl.googleOAuth.bind(ctrl);
  const appleOAuth = ctrl.appleOAuth.bind(ctrl);
  const verifyEmail = ctrl.verifyEmail.bind(ctrl);
  const resendVerification = ctrl.resendVerification.bind(ctrl);
  const refreshToken = ctrl.refreshToken.bind(ctrl);
  const logout = ctrl.logout.bind(ctrl);
  const forgotPassword = ctrl.forgotPassword.bind(ctrl);
  const resetPassword = ctrl.resetPassword.bind(ctrl);
  const requestPhoneVerification = ctrl.requestPhoneVerification.bind(ctrl);
  const confirmPhoneVerification = ctrl.confirmPhoneVerification.bind(ctrl);
  const completeProfile = ctrl.completeProfile.bind(ctrl);

  // ─────────────────────────────────────────
  // Public routes (no auth required)
  // ─────────────────────────────────────────

  fastify.post('/signup', {
    config: { rateLimit: { max: 10, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: signup,
  });

  fastify.post('/login', {
    config: { rateLimit: { max: 20, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: login,
  });

  fastify.post('/oauth/google', {
    config: { rateLimit: { max: 20, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: googleOAuth,
  });

  fastify.post('/oauth/apple', {
    config: { rateLimit: { max: 20, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: appleOAuth,
  });

  fastify.post('/verify-email', {
    config: { rateLimit: { max: 10, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: verifyEmail,
  });

  fastify.post('/resend-verification', {
    config: { rateLimit: { max: 5, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: resendVerification,
  });

  fastify.post('/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: refreshToken,
  });

  fastify.post('/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: forgotPassword,
  });

  fastify.post('/reset-password', {
    config: { rateLimit: { max: 5, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: resetPassword,
  });

  // ─────────────────────────────────────────
  // Protected routes (auth required)
  // ─────────────────────────────────────────

  fastify.post('/logout', {
    preHandler: [authenticate, sanitizeInput],
    handler: logout,
  });

  fastify.post('/phone/verify-request', {
    config: { rateLimit: { max: 5, timeWindow: '10m' } },
    preHandler: [authenticate, sanitizeInput],
    handler: requestPhoneVerification,
  });

  fastify.post('/phone/verify-confirm', {
    config: { rateLimit: { max: 10, timeWindow: '10m' } },
    preHandler: [authenticate, sanitizeInput],
    handler: confirmPhoneVerification,
  });

  fastify.post('/complete-profile', {
    preHandler: [authenticate, sanitizeInput],
    handler: completeProfile,
  });
}

module.exports = authRoutes;