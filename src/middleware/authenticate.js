'use strict';

const UnauthorizedError = require('../shared/errors/UnauthorizedError');
const AppError = require('../shared/errors/AppError');
const logger = require('../shared/utils/logger');

// ─────────────────────────────────────────
// AUTHENTICATE — Required auth
// ─────────────────────────────────────────
const authenticate = async (request, reply) => {
  try {
    // Step 1: Verify JWT signature and expiry
    await request.jwtVerify();

    // Step 2: Validate user exists and is active in DB
    const userId = request.user?.id;

    if (!userId) {
      throw new UnauthorizedError('Invalid token payload');
    }

    const { data: user, error } = await request.server.supabase
      .from('users')
      .select('id, role, account_status, email_verified, username')
      .eq('id', userId)
      .eq('is_deleted', false)
      .maybeSingle();

    if (error) {
      // DB error — don't block auth, log and continue with token data
      logger.warn(
        { error, userId },
        'DB lookup failed during auth — using token data only'
      );

      // Use data from token if DB is unavailable
      request.user = {
        id: request.user.id,
        email: request.user.email,
        username: request.user.username,
        role: request.user.role,
        account_status: 'active',
        email_verified: true,
      };
      return;
    }

    if (!user) {
      throw new UnauthorizedError('User account not found');
    }

    if (user.account_status === 'banned') {
      throw new AppError('Your account has been banned', 403, 'ACCOUNT_BANNED');
    }

    if (user.account_status === 'suspended') {
      throw new AppError(
        'Your account has been suspended',
        403,
        'ACCOUNT_SUSPENDED'
      );
    }

    // Attach fresh user data from DB
    request.user = {
      id: user.id,
      email: request.user.email,
      username: user.username || request.user.username,
      role: user.role,
      account_status: user.account_status,
      email_verified: user.email_verified,
    };
  } catch (err) {
    // Re-throw operational errors as-is
    if (err.isOperational) throw err;

    // JWT errors
    if (
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError' ||
      err.name === 'NotBeforeError' ||
      err.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' ||
      err.code === 'FST_JWT_BAD_REQUEST' ||
      err.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID'
    ) {
      if (err.name === 'TokenExpiredError' || err.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
        throw new UnauthorizedError(
          'Token expired. Please refresh your token using POST /auth/refresh'
        );
      }
      throw new UnauthorizedError('Invalid token. Please log in again.');
    }

    logger.warn(
      {
        errName: err.name,
        errCode: err.code,
        errMsg: err.message,
        ip: request.ip,
        url: request.url,
      },
      'Authentication failed'
    );

    throw new UnauthorizedError('Authentication failed. Please log in again.');
  }
};

// ─────────────────────────────────────────
// OPTIONAL AUTHENTICATE — Guest access OK
// ─────────────────────────────────────────
const optionalAuthenticate = async (request) => {
  try {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      await request.jwtVerify();

      // Try to get fresh user data
      if (request.user?.id) {
        const { data: user } = await request.server.supabase
          .from('users')
          .select('id, role, account_status, username')
          .eq('id', request.user.id)
          .eq('is_deleted', false)
          .maybeSingle();

        if (user) {
          request.user = {
            ...request.user,
            role: user.role,
            account_status: user.account_status,
            username: user.username,
          };
        }
      }
    } else {
      request.user = null;
    }
  } catch {
    // Silently fail — guest access continues
    request.user = null;
  }
};

module.exports = { authenticate, optionalAuthenticate };