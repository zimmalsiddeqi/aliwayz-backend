'use strict';

const AuthService = require('./auth.service');
const { successResponse } = require('../../shared/utils/responseFormatter');
const { authenticate } = require('../../middleware/authenticate');

const {
  signupSchema,
  loginSchema,
  googleOAuthSchema,
  appleOAuthSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  phoneVerifyRequestSchema,
  phoneVerifyConfirmSchema,
  completeProfileSchema,
} = require('./auth.schema');

const ValidationError = require('../../shared/errors/ValidationError');

class AuthController {
  constructor(fastify) {
    this.fastify = fastify;
    this.authService = new AuthService(
      fastify.supabase,
      fastify.redis,
      fastify
    );
  }

  // ─────────────────────────────────────────
  // Helper: extract device info from request
  // ─────────────────────────────────────────
  _getDeviceInfo(request) {
    return {
      ipAddress: request.ip,
      deviceId: request.headers['x-device-id'] || null,
      deviceName: request.headers['x-device-name'] || null,
      userAgent: request.headers['user-agent'] || null,
    };
  }

  // ─────────────────────────────────────────
  // Helper: validate with Zod schema
  // ─────────────────────────────────────────
  _validate(schema, data) {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      throw new ValidationError('Validation failed', errors);
    }
    return result.data;
  }

  // ─────────────────────────────────────────
  // POST /auth/signup
  // ─────────────────────────────────────────
  async signup(request, reply) {
    const data = this._validate(signupSchema, request.body);
    const deviceInfo = this._getDeviceInfo(request);
    const result = await this.authService.signup(data, deviceInfo);
    return reply.status(201).send(successResponse(result, 'Account created successfully'));
  }

  // ─────────────────────────────────────────
  // POST /auth/login
  // ─────────────────────────────────────────
  async login(request, reply) {
    const data = this._validate(loginSchema, request.body);
    const deviceInfo = this._getDeviceInfo(request);
    const result = await this.authService.login(data, deviceInfo);
    return reply.send(successResponse(result, 'Login successful'));
  }

  // ─────────────────────────────────────────
  // POST /auth/oauth/google
  // ─────────────────────────────────────────
  async googleOAuth(request, reply) {
    const data = this._validate(googleOAuthSchema, request.body);
    const deviceInfo = this._getDeviceInfo(request);
    const result = await this.authService.googleOAuth(data, deviceInfo);
    return reply.send(successResponse(result, 'Google authentication successful'));
  }

  // ─────────────────────────────────────────
  // POST /auth/oauth/apple
  // ─────────────────────────────────────────
  async appleOAuth(request, reply) {
    const data = this._validate(appleOAuthSchema, request.body);
    const deviceInfo = this._getDeviceInfo(request);
    const result = await this.authService.appleOAuth(data, deviceInfo);
    return reply.send(successResponse(result, 'Apple authentication successful'));
  }

  // ─────────────────────────────────────────
  // POST /auth/verify-email
  // ─────────────────────────────────────────
  async verifyEmail(request, reply) {
    const data = this._validate(verifyEmailSchema, request.body);
    const result = await this.authService.verifyEmail(data);
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // POST /auth/resend-verification
  // ─────────────────────────────────────────
  async resendVerification(request, reply) {
    const data = this._validate(resendVerificationSchema, request.body);
    const result = await this.authService.resendVerification(data);
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // POST /auth/refresh
  // ─────────────────────────────────────────
  async refreshToken(request, reply) {
    const data = this._validate(refreshTokenSchema, request.body);
    const result = await this.authService.refreshToken(data);
    return reply.send(successResponse(result, 'Token refreshed'));
  }

  // ─────────────────────────────────────────
  // POST /auth/logout
  // ─────────────────────────────────────────
  async logout(request, reply) {
    // authenticate middleware already ran — user is on request
    const { refresh_token, logout_all = false } = request.body || {};
    const result = await this.authService.logout(
      request.user.id,
      refresh_token,
      logout_all
    );
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // POST /auth/forgot-password
  // ─────────────────────────────────────────
  async forgotPassword(request, reply) {
    const data = this._validate(forgotPasswordSchema, request.body);
    const result = await this.authService.forgotPassword(data);
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // POST /auth/reset-password
  // ─────────────────────────────────────────
  async resetPassword(request, reply) {
    const data = this._validate(resetPasswordSchema, request.body);
    const result = await this.authService.resetPassword(data);
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // POST /auth/phone/verify-request
  // ─────────────────────────────────────────
  async requestPhoneVerification(request, reply) {
    const data = this._validate(phoneVerifyRequestSchema, request.body);
    const result = await this.authService.requestPhoneVerification(
      request.user.id,
      data.phone
    );
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // POST /auth/phone/verify-confirm
  // ─────────────────────────────────────────
  async confirmPhoneVerification(request, reply) {
    const data = this._validate(phoneVerifyConfirmSchema, request.body);
    const result = await this.authService.confirmPhoneVerification(
      request.user.id,
      data.phone,
      data.otp
    );
    return reply.send(successResponse(result));
  }

  // ─────────────────────────────────────────
  // POST /auth/complete-profile
  // ─────────────────────────────────────────
  async completeProfile(request, reply) {
    const data = this._validate(completeProfileSchema, request.body);
    const result = await this.authService.completeProfile(request.user.id, data);
    return reply.send(successResponse(result, 'Profile completed'));
  }
}

module.exports = AuthController;