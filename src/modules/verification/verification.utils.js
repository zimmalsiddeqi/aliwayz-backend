'use strict';

const crypto = require('crypto');
const sharp = require('sharp');
const AppError = require('../../shared/errors/AppError');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard IV is 12 bytes
const TAG_LENGTH = 16; // GCM standard tag is 16 bytes

/**
 * Gets the encryption key from VERIFICATION_ENCRYPTION_KEY or falls back safely to QR_SECRET_KEY
 */
function getEncryptionKey() {
  const secret = process.env.VERIFICATION_ENCRYPTION_KEY || process.env.QR_SECRET_KEY;
  if (!secret) {
    throw new Error('VERIFICATION_ENCRYPTION_KEY or QR_SECRET_KEY is required for PII encryption');
  }
  // Derive a consistent 32-byte key
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts sensitive text using AES-256-GCM
 * Returns format: ciphertext:iv:tag:keyVersion
 */
function encrypt(text, keyVersion = 'v1') {
  if (!text) return text;
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag().toString('hex');
  
  return `${encrypted}:${iv.toString('hex')}:${tag}:${keyVersion}`;
}

/**
 * Decrypts sensitive text using AES-256-GCM
 */
function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;
  
  const parts = encryptedText.split(':');
  if (parts.length < 3) {
    // Return raw text if it doesn't match our format (backward compatibility / unencrypted legacy)
    return encryptedText;
  }
  
  const [encrypted, ivHex, tagHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generates a SHA-256 document fingerprint of a buffer
 */
function generateDocumentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validates document image files (mime type, size, minimum resolution)
 */
async function validateDocumentImage(file, fieldName) {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    throw new AppError(
      `Invalid image format for ${fieldName}. Allowed types: JPEG, PNG, WebP.`,
      400,
      'INVALID_FILE_TYPE'
    );
  }

  // Max 10MB
  const maxBytes = 10 * 1024 * 1024;
  if (file.buffer.length > maxBytes) {
    throw new AppError(
      `File size for ${fieldName} exceeds the 10MB limit.`,
      400,
      'FILE_TOO_LARGE'
    );
  }

  try {
    const metadata = await sharp(file.buffer).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 600 || metadata.height < 600) {
      throw new AppError(
        `Image quality for ${fieldName} is too low. Minimum resolution is 600x600 pixels.`,
        400,
        'IMAGE_QUALITY_TOO_LOW'
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(`Invalid image file for ${fieldName}.`, 400, 'INVALID_IMAGE');
  }
}

module.exports = {
  encrypt,
  decrypt,
  generateDocumentHash,
  validateDocumentImage,
};
