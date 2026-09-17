'use strict';

const crypto = require('crypto');
const logger = require('../../shared/utils/logger');

/**
 * AES-256-GCM encryption for QR tokens
 *
 * Why AES-256-GCM:
 * - 256-bit key = military grade security
 * - GCM mode provides authenticated encryption
 * - Authentication tag prevents tampering
 * - Random IV per encryption = no two ciphertexts are same
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;         // 128-bit IV
const AUTH_TAG_LENGTH = 16;   // 128-bit auth tag
const KEY_LENGTH = 32;        // 256-bit key

class QRCrypto {
  constructor() {
    const secretKey = process.env.QR_SECRET_KEY;

    if (!secretKey) {
      throw new Error('QR_SECRET_KEY environment variable is required');
    }

    // Derive a consistent 32-byte key from the secret
    // Using SHA-256 ensures correct key length regardless of input length
    this.key = crypto
      .createHash('sha256')
      .update(secretKey)
      .digest();
  }

  // ─────────────────────────────────────────
  // ENCRYPT: Payload → Encrypted token string
  // Format: iv:authTag:ciphertext (all hex-encoded)
  // ─────────────────────────────────────────
  encrypt(payload) {
    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });

      const plaintext = JSON.stringify(payload);
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);

      const authTag = cipher.getAuthTag();

      // Combine: iv + authTag + ciphertext, all base64url encoded
      const combined = Buffer.concat([iv, authTag, encrypted]);
      return combined.toString('base64url');
    } catch (err) {
      logger.error({ err }, 'QR token encryption failed');
      throw new Error('Failed to encrypt QR token');
    }
  }

  // ─────────────────────────────────────────
  // DECRYPT: Encrypted token string → Payload
  // Returns null if token is invalid/tampered
  // ─────────────────────────────────────────
  decrypt(token) {
    try {
      if (!token || typeof token !== 'string') return null;
      let cleanToken = token.trim().replace(/^["']|["']$/g, '');
      if (cleanToken.includes('%')) {
        try {
          cleanToken = decodeURIComponent(cleanToken);
        } catch {}
      }

      let combined;
      try {
        combined = Buffer.from(cleanToken, 'base64url');
      } catch {
        combined = null;
      }

      if (!combined || combined.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
        try {
          combined = Buffer.from(cleanToken.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        } catch {}
      }

      if (!combined || combined.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
        return null; // Token too short — invalid
      }

      const iv = combined.subarray(0, IV_LENGTH);
      const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });

      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(), // Throws if auth tag verification fails (tampered)
      ]);

      return JSON.parse(decrypted.toString('utf8'));
    } catch (err) {
      // Do not log the token itself — security risk
      logger.warn({ errMsg: err.message }, 'QR token decryption failed — invalid or tampered');
      return null;
    }
  }

  // ─────────────────────────────────────────
  // HASH: Create SHA-256 hash of token
  // Used as Redis key and DB storage (never store raw token)
  // ─────────────────────────────────────────
  hash(token) {
    let clean = typeof token === 'string' ? token.trim().replace(/^["']|["']$/g, '') : '';
    if (clean.includes('%')) {
      try {
        clean = decodeURIComponent(clean);
      } catch {}
    }
    // Normalize to base64url if possible for consistent hashing
    try {
      const buf = Buffer.from(clean, 'base64url');
      if (buf.length > 0) {
        clean = buf.toString('base64url');
      }
    } catch {}

    return crypto
      .createHash('sha256')
      .update(clean)
      .digest('hex');
  }

  // ─────────────────────────────────────────
  // GENERATE: Create full QR payload + token
  // ─────────────────────────────────────────
  generateToken(payload) {
    const token = this.encrypt(payload);
    const tokenHash = this.hash(token);
    return { token, tokenHash };
  }
}

// Singleton — one instance for the entire app
const qrCrypto = new QRCrypto();
module.exports = qrCrypto;