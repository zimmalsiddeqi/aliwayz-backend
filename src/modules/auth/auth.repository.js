'use strict';

const logger = require('../../shared/utils/logger');

class AuthRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Find user by email
  // ─────────────────────────────────────────
  async findUserByEmail(email) {
    const { data, error } = await this.supabase
      .from('users')
      .select(
        'id, email, username, full_name, avatar_url, role, account_status, email_verified, phone_verified, auth_provider, supabase_uid, fcm_token, seller_verification_status'
      )
      .eq('email', email)
      .eq('is_deleted', false)
      .maybeSingle(); // Use maybeSingle instead of single to avoid errors when not found

    if (error) {
      logger.error({ error, email }, 'findUserByEmail failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Find user by ID
  // ─────────────────────────────────────────
  async findUserById(id) {
    const { data, error } = await this.supabase
      .from('users')
      .select(
        'id, email, username, full_name, avatar_url, role, account_status, email_verified, phone_verified, auth_provider, supabase_uid, seller_verification_status'
      )
      .eq('id', id)
      .eq('is_deleted', false)
      .maybeSingle();

    if (error) {
      logger.error({ error, id }, 'findUserById failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Find user by username
  // ─────────────────────────────────────────
  async findUserByUsername(username) {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, username')
      .eq('username', username)
      .eq('is_deleted', false)
      .maybeSingle();

    if (error) {
      logger.error({ error, username }, 'findUserByUsername failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Find user by Supabase UID
  // ─────────────────────────────────────────
  async findUserBySupabaseUid(supabaseUid) {
    const { data, error } = await this.supabase
      .from('users')
      .select(
        'id, email, username, full_name, avatar_url, role, account_status, email_verified, auth_provider, supabase_uid'
      )
      .eq('supabase_uid', supabaseUid)
      .eq('is_deleted', false)
      .maybeSingle();

    if (error) {
      logger.error({ error }, 'findUserBySupabaseUid failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Create new user
  // ─────────────────────────────────────────
  async createUser(userData) {
    logger.info(
      { email: userData.email, username: userData.username, role: userData.role },
      'Attempting to create user in DB'
    );

    const { data, error } = await this.supabase
      .from('users')
      .insert({
        email: userData.email,
        username: userData.username,
        full_name: userData.full_name || null,
        avatar_url: userData.avatar_url || null,
        role: userData.role,
        auth_provider: userData.auth_provider || 'email',
        supabase_uid: userData.supabase_uid,
        account_status: userData.account_status || 'active',
        email_verified: userData.email_verified || false,
        phone_verified: false,
        is_deleted: false,
      })
      .select(
        'id, email, username, full_name, avatar_url, role, account_status, email_verified, phone_verified, auth_provider, supabase_uid'
      )
      .single();

    if (error) {
      logger.error(
        {
          error,
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
          email: userData.email,
        },
        'createUser DB insert failed'
      );
      throw error;
    }

    logger.info(
      { userId: data.id, email: data.email },
      'User created in DB successfully'
    );

    return data;
  }

  // ─────────────────────────────────────────
  // Update user
  // ─────────────────────────────────────────
  async updateUser(id, updates) {
    const { data, error } = await this.supabase
      .from('users')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(
        'id, email, username, full_name, role, account_status, email_verified, phone_verified, location_city'
      )
      .single();

    if (error) {
      logger.error({ error, id }, 'updateUser failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Store refresh token
  // ─────────────────────────────────────────
  async storeRefreshToken(userId, tokenHash, expiresAt, deviceInfo = {}) {
    const { error } = await this.supabase
      .from('refresh_tokens')
      .insert({
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        device_id: deviceInfo.deviceId || null,
        device_name: deviceInfo.deviceName || null,
        ip_address: deviceInfo.ipAddress || null,
      });

    if (error) {
      logger.error({ error, userId }, 'storeRefreshToken failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Find refresh token
  // ─────────────────────────────────────────
  async findRefreshToken(tokenHash) {
    const { data, error } = await this.supabase
      .from('refresh_tokens')
      .select('id, user_id, expires_at, is_revoked')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) {
      logger.error({ error }, 'findRefreshToken failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Revoke refresh token
  // ─────────────────────────────────────────
  async revokeRefreshToken(tokenHash) {
    const { error } = await this.supabase
      .from('refresh_tokens')
      .update({
        is_revoked: true,
        revoked_at: new Date().toISOString(),
      })
      .eq('token_hash', tokenHash);

    if (error) {
      logger.error({ error }, 'revokeRefreshToken failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Revoke all refresh tokens for user
  // ─────────────────────────────────────────
  async revokeAllUserRefreshTokens(userId) {
    const { error } = await this.supabase
      .from('refresh_tokens')
      .update({
        is_revoked: true,
        revoked_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('is_revoked', false);

    if (error) {
      logger.error({ error, userId }, 'revokeAllUserRefreshTokens failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Store email verification token
  // ─────────────────────────────────────────
  async storeEmailVerificationToken(email, tokenHash, expiresAt) {
    const { error } = await this.supabase
      .from('email_verification_tokens')
      .upsert(
        {
          email,
          token_hash: tokenHash,
          expires_at: expiresAt,
          is_used: false,
        },
        { onConflict: 'email' }
      );

    if (error) {
      logger.error({ error, email }, 'storeEmailVerificationToken failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Find email verification token
  // ─────────────────────────────────────────
  async findEmailVerificationToken(email, tokenHash) {
    const { data, error } = await this.supabase
      .from('email_verification_tokens')
      .select('id, email, expires_at, is_used')
      .eq('email', email)
      .eq('token_hash', tokenHash)
      .eq('is_used', false)
      .maybeSingle();

    if (error) {
      logger.error({ error }, 'findEmailVerificationToken failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Consume email verification token
  // ─────────────────────────────────────────
  async consumeEmailVerificationToken(id) {
    const { error } = await this.supabase
      .from('email_verification_tokens')
      .update({
        is_used: true,
        used_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      logger.error({ error }, 'consumeEmailVerificationToken failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Store password reset token
  // ─────────────────────────────────────────
  async storePasswordResetToken(email, tokenHash, expiresAt) {
    const { error } = await this.supabase
      .from('password_reset_tokens')
      .upsert(
        {
          email,
          token_hash: tokenHash,
          expires_at: expiresAt,
          is_used: false,
        },
        { onConflict: 'email' }
      );

    if (error) {
      logger.error({ error, email }, 'storePasswordResetToken failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Find password reset token
  // ─────────────────────────────────────────
  async findPasswordResetToken(email, tokenHash) {
    const { data, error } = await this.supabase
      .from('password_reset_tokens')
      .select('id, email, expires_at, is_used')
      .eq('email', email)
      .eq('token_hash', tokenHash)
      .eq('is_used', false)
      .maybeSingle();

    if (error) {
      logger.error({ error }, 'findPasswordResetToken failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Consume password reset token
  // ─────────────────────────────────────────
  async consumePasswordResetToken(id) {
    const { error } = await this.supabase
      .from('password_reset_tokens')
      .update({
        is_used: true,
        used_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      logger.error({ error }, 'consumePasswordResetToken failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Initialize seller stats
  // ─────────────────────────────────────────
  async initializeSellerStats(userId) {
    const { error } = await this.supabase
      .from('seller_stats')
      .upsert(
        { user_id: userId },
        { onConflict: 'user_id' }
      );

    if (error) {
      logger.error({ error, userId }, 'initializeSellerStats failed');
      throw error;
    }
  }
}

module.exports = AuthRepository;