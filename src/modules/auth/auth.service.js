"use strict";

const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const dayjs = require("dayjs");

const AuthRepository = require("./auth.repository");
const BadgeEngine = require("../badges/badge.engine");
const NotificationService = require("../notifications/notification.service");

const appConfig = require("../../config/app.config");
const logger = require("../../shared/utils/logger");

const AppError = require("../../shared/errors/AppError");
const NotFoundError = require("../../shared/errors/NotFoundError");
const UnauthorizedError = require("../../shared/errors/UnauthorizedError");

const { CACHE_KEYS } = require("../../shared/constants/cacheKeys");
const { ROLES } = require("../../shared/constants/roles");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

class AuthService {
  constructor(supabase, redis, fastify) {
    this.supabase = supabase;
    this.redis = redis;
    this.fastify = fastify;
    this.repo = new AuthRepository(supabase);
    this.badgeEngine = new BadgeEngine(supabase, redis);
    this.notificationService = new NotificationService(supabase, redis);
  }

  // ─────────────────────────────────────────
  // PRIVATE: Generate secure random token
  // ─────────────────────────────────────────
  _generateSecureToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString("hex");
  }

  _hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  // ─────────────────────────────────────────
  // PRIVATE: Sign JWT access token
  // ─────────────────────────────────────────
  _signAccessToken(payload) {
    return this.fastify.jwt.sign(payload, {
      expiresIn: appConfig.jwt.accessExpiresIn,
    });
  }

  // ─────────────────────────────────────────
  // PRIVATE: Sign JWT refresh token
  // ─────────────────────────────────────────
  _signRefreshToken(payload) {
    return this.fastify.jwt.sign(payload, {
      expiresIn: appConfig.jwt.refreshExpiresIn,
    });
  }

  // ─────────────────────────────────────────
  // PRIVATE: Issue access + refresh token pair
  // ─────────────────────────────────────────
  async _issueTokenPair(user, deviceInfo = {}) {
    const accessPayload = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    const refreshPayload = {
      id: user.id,
      type: "refresh",
    };

    const accessToken = this._signAccessToken(accessPayload);
    const refreshToken = this._signRefreshToken(refreshPayload);
    const refreshTokenHash = this._hashToken(refreshToken);

    const expiresAt = dayjs().add(7, "day").toISOString();

    await this.repo.storeRefreshToken(
      user.id,
      refreshTokenHash,
      expiresAt,
      deviceInfo,
    );

    return { accessToken, refreshToken };
  }

  // ─────────────────────────────────────────
  // PRIVATE: Format user for API response
  // Never expose sensitive fields
  // ─────────────────────────────────────────
  _formatUserResponse(user) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      full_name: user.full_name || null,
      avatar_url: user.avatar_url || null,
      role: user.role,
      account_status: user.account_status,
      email_verified: user.email_verified,
      phone_verified: user.phone_verified || false,
      auth_provider: user.auth_provider,
    };
  }

  // ─────────────────────────────────────────
  // PRIVATE: Handle Supabase Auth errors
  // Maps Supabase error codes to our errors
  // ─────────────────────────────────────────
  _handleSupabaseAuthError(authError, context = "signup") {
    const code = authError.code || "";
    const message = authError.message || "";
    const status = authError.status || 500;

    logger.error({ code, message, status, context }, "Supabase auth error");

    // Email provider disabled
    if (code === "email_provider_disabled") {
      throw new AppError(
        "Email signup is currently disabled. Please enable Email provider in Supabase Authentication settings.",
        503,
        "AUTH_PROVIDER_DISABLED",
      );
    }

    // Rate limit
    if (code === "over_email_send_rate_limit" || status === 429) {
      throw new AppError(
        "Too many attempts. Please wait a few minutes and try again.",
        429,
        "RATE_LIMIT",
      );
    }

    // Already registered
    if (
      message.includes("already registered") ||
      message.includes("already exists") ||
      code === "user_already_exists"
    ) {
      throw new AppError(
        "An account with this email already exists",
        409,
        "EMAIL_TAKEN",
      );
    }

    // Invalid email
    if (message.includes("invalid") && message.includes("email")) {
      throw new AppError("Invalid email address", 400, "INVALID_EMAIL");
    }

    // Weak password
    if (message.includes("password")) {
      throw new AppError(
        "Password does not meet requirements",
        400,
        "WEAK_PASSWORD",
      );
    }

    // Default
    throw new AppError(
      `Authentication failed: ${message}`,
      status >= 400 && status < 600 ? status : 500,
      "AUTH_FAILED",
    );
  }

  // ─────────────────────────────────────────
// SIGNUP — COMPLETE REWRITE
// ─────────────────────────────────────────
async signup(data, deviceInfo = {}) {
  const { email, password, username, full_name, role } = data;

  // ── Step 1: Check duplicates ──────────────────────────
  const [existingEmail, existingUsername] = await Promise.all([
    this.repo.findUserByEmail(email),
    this.repo.findUserByUsername(username),
  ]);

  if (existingEmail) {
    throw new AppError(
      'An account with this email already exists',
      409,
      'EMAIL_TAKEN'
    );
  }

  if (existingUsername) {
    throw new AppError(
      'This username is already taken',
      409,
      'USERNAME_TAKEN'
    );
  }

  // ── Step 2: Create Supabase Auth user ─────────────────
  let supabaseUserId = null;
  let usedAdminApi   = false;

  logger.info({ email, username }, 'Attempting Supabase auth signup');

  // Always try standard signUp first — this correctly hashes password
  const { data: authData, error: authError } =
    await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, role },
      },
    });

  if (authError) {
    logger.warn(
      {
        code:    authError.code,
        message: authError.message,
        status:  authError.status,
      },
      'Standard signUp failed — trying admin fallback'
    );

    // Rate limit or email provider disabled → use admin API
    const isRateLimit = (
      authError.status === 429 ||
      authError.code === 'over_email_send_rate_limit' ||
      authError.code === 'over_request_rate_limit'
    );

    const isProviderDisabled = (
      authError.code === 'email_provider_disabled' ||
      authError.message?.includes('Email provider is not enabled')
    );

    const isAlreadyExists = (
      authError.message?.includes('already registered') ||
      authError.message?.includes('already exists') ||
      authError.code === 'user_already_exists' ||
      authError.code === 'email_exists'
    );

    if (isAlreadyExists) {
      throw new AppError(
        'An account with this email already exists',
        409,
        'EMAIL_TAKEN'
      );
    }

    if (isRateLimit || isProviderDisabled || authError.status >= 500) {
      // ── Admin API fallback ───────────────────────────
      const { data: adminData, error: adminError } =
        await this.supabase.auth.admin.createUser({
          email,
          password,            // ← Pass password here
          email_confirm: true,
          user_metadata: { username, role },
        });

      if (adminError) {
        if (
          adminError.message?.includes('already registered') ||
          adminError.code === 'email_exists'
        ) {
          throw new AppError(
            'An account with this email already exists',
            409,
            'EMAIL_TAKEN'
          );
        }
        logger.error({ adminError }, 'Admin createUser failed');
        throw new AppError(
          'Signup failed. Please try again later.',
          503,
          'SIGNUP_FAILED'
        );
      }

      supabaseUserId = adminData.user.id;
      usedAdminApi   = true;

      // ── CRITICAL: Explicitly update password via admin ─
      // admin.createUser with password sometimes doesn't hash
      // correctly for signInWithPassword — force update it
      const { error: updateError } =
        await this.supabase.auth.admin.updateUserById(
          supabaseUserId,
          { password }
        );

      if (updateError) {
        logger.warn({ updateError }, 'Password update after admin create failed');
        // Non-fatal — attempt continues
      } else {
        logger.info({ supabaseUserId }, 'Password set via admin.updateUserById');
      }

    } else {
      // Unknown error
      throw new AppError(
        `Signup failed: ${authError.message}`,
        authError.status >= 400 && authError.status < 600
          ? authError.status
          : 500,
        'SIGNUP_FAILED'
      );
    }

  } else {
    // Standard signup succeeded
    if (!authData?.user?.id) {
      logger.error({ authData }, 'Supabase returned no user ID');
      throw new AppError('Signup failed — no user returned', 500, 'SIGNUP_FAILED');
    }

    supabaseUserId = authData.user.id;

    // If user was already in Supabase but not in our DB
    // (can happen if previous signup partially failed)
    if (authData.user.identities?.length === 0) {
      logger.warn({ email }, 'User already exists in Supabase Auth');
      throw new AppError(
        'An account with this email already exists',
        409,
        'EMAIL_TAKEN'
      );
    }
  }

  logger.info({ supabaseUserId, email, usedAdminApi }, 'Supabase auth user ready');

  // ── Step 3: Create user in our DB ────────────────────
  let newUser;
  try {
    newUser = await this.repo.createUser({
      email,
      username,
      full_name:      full_name || null,
      role,
      auth_provider:  'email',
      supabase_uid:   supabaseUserId,
      account_status: 'active',
      email_verified: !appConfig.isProduction,
    });
  } catch (dbError) {
    logger.error(
      {
        dbErrorCode:    dbError.code,
        dbErrorMessage: dbError.message,
        dbErrorDetails: dbError.details,
        email,
        username,
        supabaseUserId,
      },
      'DB user creation failed — rolling back Supabase user'
    );

    // Rollback Supabase auth user
    try {
      await this.supabase.auth.admin.deleteUser(supabaseUserId);
      logger.info({ supabaseUserId }, 'Supabase auth user rolled back');
    } catch (rollbackErr) {
      logger.error({ rollbackErr }, 'Rollback failed');
    }

    if (dbError.code === '23505') {
      const detail = dbError.details || dbError.message || '';
      if (detail.includes('email')) {
        throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');
      }
      if (detail.includes('username')) {
        throw new AppError('This username is already taken', 409, 'USERNAME_TAKEN');
      }
      throw new AppError('Account already exists', 409, 'DUPLICATE_USER');
    }

    throw new AppError(
      `Account creation failed: ${dbError.message || 'Database error'}`,
      500,
      'DB_ERROR'
    );
  }

  // ── Step 4: Initialize seller stats (non-blocking) ────
  if ([ROLES.SELLER, ROLES.BOTH].includes(role)) {
    try {
      await this.repo.initializeSellerStats(newUser.id);
      logger.info({ userId: newUser.id }, 'Seller stats initialized');
      this.badgeEngine
        .evaluateAndAssignBadges(newUser.id, 'signup')
        .catch((e) => logger.warn({ e }, 'Badge eval failed — non-critical'));
    } catch (err) {
      logger.warn({ err, userId: newUser.id }, 'Seller stats init failed — non-critical');
    }
  }

  // ── Step 5: Issue tokens ──────────────────────────────
  const { accessToken, refreshToken } = await this._issueTokenPair(
    newUser,
    deviceInfo
  );

  logger.info(
    { userId: newUser.id, role, email },
    'New user registered successfully'
  );

  return {
    user:                        this._formatUserResponse(newUser),
    access_token:                accessToken,
    refresh_token:               refreshToken,
    requires_email_verification: appConfig.isProduction,
  };
}

  // ─────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────
async login(data, deviceInfo = {}) {
  const { email, password } = data;

  // Check user exists in our DB first
  const user = await this.repo.findUserByEmail(email);

  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (user.account_status === 'banned') {
    throw new AppError(
      'Your account has been banned. Contact support.',
      403,
      'ACCOUNT_BANNED'
    );
  }

  if (user.account_status === 'suspended') {
    throw new AppError(
      'Your account has been suspended. Contact support.',
      403,
      'ACCOUNT_SUSPENDED'
    );
  }

  if (user.auth_provider !== 'email') {
    throw new AppError(
      `Please sign in with ${user.auth_provider}`,
      400,
      'WRONG_AUTH_PROVIDER'
    );
  }

  // ── Verify password via Supabase ────────────────────────
  const { data: signInData, error: signInError } =
    await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

  if (signInError) {
    // ── Log the FULL Supabase error for debugging ────────
    logger.warn(
      {
        email,
        ip:              deviceInfo.ipAddress,
        supabaseCode:    signInError.code,
        supabaseMessage: signInError.message,
        supabaseStatus:  signInError.status,
      },
      'Failed login attempt — Supabase signInWithPassword error'
    );

    // ── Handle email not confirmed ───────────────────────
    if (
      signInError.message?.includes('Email not confirmed') ||
      signInError.code === 'email_not_confirmed'
    ) {
      throw new AppError(
        'Please verify your email before logging in.',
        403,
        'EMAIL_NOT_VERIFIED'
      );
    }

    throw new UnauthorizedError('Invalid email or password');
  }

  if (!signInData?.user) {
    logger.warn({ email }, 'Supabase returned no user on login');
    throw new UnauthorizedError('Invalid email or password');
  }

  // Update last active
  await this.repo.updateUser(user.id, {
    last_active_at: new Date().toISOString(),
  });

  const { accessToken, refreshToken } = await this._issueTokenPair(
    user,
    deviceInfo
  );

  logger.info({ userId: user.id }, 'User logged in successfully');

  return {
    user:                       this._formatUserResponse(user),
    access_token:               accessToken,
    refresh_token:              refreshToken,
    requires_email_verification: !user.email_verified,
  };
}
  // ─────────────────────────────────────────
  // GOOGLE OAUTH
  // Accepts id_token (Google credential/One Tap) OR
  // access_token (implicit popup flow from @react-oauth/google).
  // Backward-compatible — existing callers using id_token unchanged.
  // ─────────────────────────────────────────
  async googleOAuth(data, deviceInfo = {}) {
    const { id_token, access_token, role } = data;

    let googlePayload;

    // ── Path A: id_token (preferred — Google credential/One Tap) ──────────
    if (id_token) {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: id_token,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        googlePayload = ticket.getPayload();
      } catch (err) {
        logger.warn({ err: err.message }, "Invalid Google ID token");
        throw new UnauthorizedError("Invalid Google token");
      }
    }
    // ── Path B: access_token (@react-oauth/google implicit popup flow) ─────
    else if (access_token) {
      try {
        const res = await fetch(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          { headers: { Authorization: `Bearer ${access_token}` } }
        );
        if (!res.ok) throw new Error(`Google userinfo HTTP ${res.status}`);
        const info = await res.json();
        if (!info.email_verified) {
          throw new UnauthorizedError("Google account email is not verified");
        }
        googlePayload = {
          email:   info.email,
          name:    info.name,
          picture: info.picture,
          sub:     info.sub,
        };
      } catch (err) {
        logger.warn({ err: err.message }, "Failed to verify Google access token");
        throw new UnauthorizedError("Invalid Google token");
      }
    } else {
      throw new AppError("Google token is required (id_token or access_token)", 400, "MISSING_TOKEN");
    }

    const { email, name, picture } = googlePayload;

    if (!email) {
      throw new AppError("Google account must have an email", 400);
    }

    let user = await this.repo.findUserByEmail(email);

    if (user) {
      if (user.account_status === "banned") {
        throw new AppError(
          "Your account has been banned",
          403,
          "ACCOUNT_BANNED",
        );
      }
      await this.repo.updateUser(user.id, {
        last_active_at: new Date().toISOString(),
        email_verified: true,
      });
      user = await this.repo.findUserByEmail(email);
    } else {
      const baseUsername = email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .substring(0, 40);
      const username = await this._generateUniqueUsername(baseUsername);

      const { data: authData, error: authError } =
        await this.supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { full_name: name, avatar_url: picture },
        });

      if (authError) {
        this._handleSupabaseAuthError(authError, "google_oauth");
      }

      user = await this.repo.createUser({
        email,
        username,
        full_name: name || null,
        avatar_url: picture || null,
        role,
        auth_provider: "google",
        supabase_uid: authData.user.id,
        account_status: "active",
        email_verified: true,
      });

      if ([ROLES.SELLER, ROLES.BOTH].includes(role)) {
        await this.repo.initializeSellerStats(user.id).catch(() => {});
        this.badgeEngine
          .evaluateAndAssignBadges(user.id, "signup")
          .catch(() => {});
      }
    }

    const { accessToken, refreshToken } = await this._issueTokenPair(
      user,
      deviceInfo,
    );

    return {
      user: this._formatUserResponse(user),
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  // ─────────────────────────────────────────
  // APPLE OAUTH
  // ─────────────────────────────────────────
  async appleOAuth(data, deviceInfo = {}) {
    const { identity_token, full_name, role } = data;

    const { data: authData, error: authError } =
      await this.supabase.auth.signInWithIdToken({
        provider: "apple",
        token: identity_token,
      });

    if (authError || !authData?.user) {
      logger.warn({ authError }, "Invalid Apple identity token");
      throw new UnauthorizedError("Invalid Apple token");
    }

    const email = authData.user.email;
    if (!email) {
      throw new AppError("Apple account must provide an email", 400);
    }

    let user = await this.repo.findUserByEmail(email);

    if (user) {
      if (user.account_status === "banned") {
        throw new AppError(
          "Your account has been banned",
          403,
          "ACCOUNT_BANNED",
        );
      }
      await this.repo.updateUser(user.id, {
        last_active_at: new Date().toISOString(),
      });
      user = await this.repo.findUserByEmail(email);
    } else {
      const baseUsername = email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .substring(0, 40);
      const username = await this._generateUniqueUsername(baseUsername);

      user = await this.repo.createUser({
        email,
        username,
        full_name: full_name || null,
        role,
        auth_provider: "apple",
        supabase_uid: authData.user.id,
        account_status: "active",
        email_verified: true,
      });

      if ([ROLES.SELLER, ROLES.BOTH].includes(role)) {
        await this.repo.initializeSellerStats(user.id).catch(() => {});
        this.badgeEngine
          .evaluateAndAssignBadges(user.id, "signup")
          .catch(() => {});
      }
    }

    const { accessToken, refreshToken } = await this._issueTokenPair(
      user,
      deviceInfo,
    );

    return {
      user: this._formatUserResponse(user),
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  // ─────────────────────────────────────────
  // VERIFY EMAIL
  // ─────────────────────────────────────────
  async verifyEmail(data) {
    const { email, token } = data;
    const tokenHash = this._hashToken(token);

    const tokenRecord = await this.repo.findEmailVerificationToken(
      email,
      tokenHash,
    );

    if (!tokenRecord) {
      throw new AppError(
        "Invalid or expired verification token",
        400,
        "INVALID_TOKEN",
      );
    }

    if (dayjs().isAfter(dayjs(tokenRecord.expires_at))) {
      throw new AppError(
        "Verification token has expired. Please request a new one.",
        400,
        "TOKEN_EXPIRED",
      );
    }

    const user = await this.repo.findUserByEmail(email);
    if (!user) throw new NotFoundError("User");

    await Promise.all([
      this.repo.consumeEmailVerificationToken(tokenRecord.id),
      this.repo.updateUser(user.id, { email_verified: true }),
    ]);

    return { message: "Email verified successfully" };
  }

  // ─────────────────────────────────────────
  // RESEND VERIFICATION
  // ─────────────────────────────────────────
  async resendVerification(data) {
    const { email } = data;

    const user = await this.repo.findUserByEmail(email);
    if (!user) {
      return {
        message: "If this email exists, a verification link has been sent.",
      };
    }

    if (user.email_verified) {
      throw new AppError("Email is already verified", 400, "ALREADY_VERIFIED");
    }

    const rateLimitKey = `email_verify_resend:${email}`;
    const attempts = await this.redis.incr(rateLimitKey, 300);

    if (attempts > 3) {
      throw new AppError(
        "Too many resend requests. Please wait 5 minutes.",
        429,
        "RESEND_RATE_LIMIT",
      );
    }

    const verificationToken = this._generateSecureToken();
    const verificationTokenHash = this._hashToken(verificationToken);
    const expiresAt = dayjs().add(24, "hour").toISOString();

    await this.repo.storeEmailVerificationToken(
      email,
      verificationTokenHash,
      expiresAt,
    );

    await this._sendVerificationEmail(email, user.username, verificationToken);

    return {
      message: "If this email exists, a verification link has been sent.",
    };
  }

  // ─────────────────────────────────────────
  // REFRESH TOKEN
  // ─────────────────────────────────────────
  async refreshToken(data) {
    const { refresh_token } = data;

    let decoded;
    try {
      decoded = this.fastify.jwt.decode(refresh_token);
    } catch {
      throw new UnauthorizedError("Invalid refresh token");
    }

    if (!decoded || decoded.type !== "refresh") {
      throw new UnauthorizedError("Invalid refresh token");
    }

    const tokenHash = this._hashToken(refresh_token);
    const tokenRecord = await this.repo.findRefreshToken(tokenHash);

    if (!tokenRecord) {
      throw new UnauthorizedError("Refresh token not found or already used");
    }

    if (tokenRecord.is_revoked) {
      logger.warn(
        { userId: decoded.id },
        "Revoked refresh token reuse detected",
      );
      await this.repo.revokeAllUserRefreshTokens(decoded.id);
      throw new UnauthorizedError("Security alert: Please log in again");
    }

    if (dayjs().isAfter(dayjs(tokenRecord.expires_at))) {
      throw new UnauthorizedError(
        "Refresh token has expired. Please log in again.",
      );
    }

    const user = await this.repo.findUserById(decoded.id);
    if (!user || user.account_status !== "active") {
      throw new UnauthorizedError("User account is not active");
    }

    await this.repo.revokeRefreshToken(tokenHash);

    const { accessToken, refreshToken } = await this._issueTokenPair(user);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  // ─────────────────────────────────────────
  // LOGOUT
  // ─────────────────────────────────────────
  async logout(userId, refreshToken, logoutAll = false) {
    if (logoutAll) {
      await this.repo.revokeAllUserRefreshTokens(userId);
    } else if (refreshToken) {
      const tokenHash = this._hashToken(refreshToken);
      await this.repo.revokeRefreshToken(tokenHash);
    }

    return { message: "Logged out successfully" };
  }

  // ─────────────────────────────────────────
  // FORGOT PASSWORD
  // ─────────────────────────────────────────
  async forgotPassword(data) {
    const { email } = data;
    const user = await this.repo.findUserByEmail(email);

    if (!user || user.auth_provider !== "email") {
      return {
        message: "If this email exists, a password reset link has been sent.",
      };
    }

    const rateLimitKey = `pwd_reset:${email}`;
    const attempts = await this.redis.incr(rateLimitKey, 600);

    if (attempts > 3) {
      return {
        message: "If this email exists, a password reset link has been sent.",
      };
    }

    const resetToken = this._generateSecureToken();
    const resetTokenHash = this._hashToken(resetToken);
    const expiresAt = dayjs().add(1, "hour").toISOString();

    await this.repo.storePasswordResetToken(email, resetTokenHash, expiresAt);
    await this._sendPasswordResetEmail(email, user.username, resetToken);

    return {
      message: "If this email exists, a password reset link has been sent.",
    };
  }

  // ─────────────────────────────────────────
  // RESET PASSWORD
  // ─────────────────────────────────────────
  async resetPassword(data) {
    const { email, token, new_password } = data;

    const tokenHash = this._hashToken(token);
    const tokenRecord = await this.repo.findPasswordResetToken(
      email,
      tokenHash,
    );

    if (!tokenRecord) {
      throw new AppError(
        "Invalid or expired reset token",
        400,
        "INVALID_TOKEN",
      );
    }

    if (dayjs().isAfter(dayjs(tokenRecord.expires_at))) {
      throw new AppError(
        "Password reset token has expired",
        400,
        "TOKEN_EXPIRED",
      );
    }

    const user = await this.repo.findUserByEmail(email);
    if (!user) throw new NotFoundError("User");

    const { error: updateError } =
      await this.supabase.auth.admin.updateUserById(user.supabase_uid, {
        password: new_password,
      });

    if (updateError) {
      logger.error({ updateError }, "Failed to update password");
      throw new AppError("Failed to update password", 500);
    }

    await Promise.all([
      this.repo.consumePasswordResetToken(tokenRecord.id),
      this.repo.revokeAllUserRefreshTokens(user.id),
    ]);

    return {
      message: "Password updated successfully. Please log in again.",
    };
  }

  // ─────────────────────────────────────────
  // PHONE VERIFY REQUEST
  // ─────────────────────────────────────────
  async requestPhoneVerification(userId, phone) {
    const { data: existingPhone } = await this.supabase
      .from("users")
      .select("id")
      .eq("phone", phone)
      .eq("phone_verified", true)
      .neq("id", userId)
      .single();

    if (existingPhone) {
      throw new AppError(
        "This phone number is already verified by another account",
        409,
        "PHONE_TAKEN",
      );
    }

    const { error } = await this.supabase.auth.signInWithOtp({ phone });

    if (error) {
      logger.error({ error }, "Failed to send OTP");
      throw new AppError("Failed to send OTP. Please try again.", 500);
    }

    await this.redis.set(`phone_pending:${userId}`, { phone }, 600);

    return { message: "OTP sent to your phone number" };
  }

  // ─────────────────────────────────────────
  // PHONE VERIFY CONFIRM
  // ─────────────────────────────────────────
  async confirmPhoneVerification(userId, phone, otp) {
    const { data, error } = await this.supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: "sms",
    });

    if (error || !data) {
      throw new AppError("Invalid or expired OTP", 400, "INVALID_OTP");
    }

    await this.repo.updateUser(userId, { phone, phone_verified: true });
    await this.redis.del(`phone_pending:${userId}`);

    this.badgeEngine
      .evaluateAndAssignBadges(userId, "phone_verified")
      .catch(() => {});

    return { message: "Phone verified successfully" };
  }

  // ─────────────────────────────────────────
  // COMPLETE PROFILE
  // ─────────────────────────────────────────
  async completeProfile(userId, data) {
    const {
      username,
      full_name,
      role,
      location_city,
      location_lat,
      location_lng,
    } = data;

    const existingUsername = await this.repo.findUserByUsername(username);
    if (existingUsername && existingUsername.id !== userId) {
      throw new AppError("Username is already taken", 409, "USERNAME_TAKEN");
    }

    const updatedUser = await this.repo.updateUser(userId, {
      username,
      full_name: full_name || null,
      role,
      location_city: location_city || null,
      location_lat: location_lat || null,
      location_lng: location_lng || null,
    });

    if ([ROLES.SELLER, ROLES.BOTH].includes(role)) {
      await this.repo.initializeSellerStats(userId).catch(() => {});
      this.badgeEngine
        .evaluateAndAssignBadges(userId, "signup")
        .catch(() => {});
    }

    await this.redis.del(CACHE_KEYS.USER_PROFILE(username));

    return { user: this._formatUserResponse(updatedUser) };
  }

  // ─────────────────────────────────────────
  // PRIVATE: Generate unique username
  // ─────────────────────────────────────────
  async _generateUniqueUsername(base) {
    let username = base.substring(0, 42);
    let attempt = 0;

    while (attempt < 10) {
      const candidate =
        attempt === 0
          ? username
          : `${username}${Math.floor(Math.random() * 9999)}`;

      const existing = await this.repo.findUserByUsername(candidate);
      if (!existing) return candidate;

      attempt++;
    }

    return `${username}${Date.now()}`.substring(0, 50);
  }

  // ─────────────────────────────────────────
  // PRIVATE: Send verification email (stub)
  // ─────────────────────────────────────────
  async _sendVerificationEmail(email, username, token) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
    logger.info({ email, verificationUrl }, "Verification email queued");
    // TODO: Integrate email provider
  }

  // ─────────────────────────────────────────
  // PRIVATE: Send password reset email (stub)
  // ─────────────────────────────────────────
  async _sendPasswordResetEmail(email, username, token) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    logger.info({ email, resetUrl }, "Password reset email queued");
    // TODO: Integrate email provider
  }
}

module.exports = AuthService;
