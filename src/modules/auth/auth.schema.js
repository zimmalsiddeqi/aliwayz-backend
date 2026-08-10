'use strict';

const { z } = require('zod');

// ─────────────────────────────────────────
// Reusable field validators
// ─────────────────────────────────────────
const emailField = z
  .string()
  .email('Invalid email address')
  .min(5)
  .max(255)
  .toLowerCase()
  .trim();

const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
    'Password must contain uppercase, lowercase, number, and special character'
  );

const usernameField = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(50, 'Username too long')
  .regex(
    /^[a-zA-Z0-9_]+$/,
    'Username can only contain letters, numbers, and underscores'
  )
  .toLowerCase()
  .trim();

// ─────────────────────────────────────────
// Schema definitions
// ─────────────────────────────────────────
const signupSchema = z.object({
  email: emailField,
  password: passwordField,
  username: usernameField,
  full_name: z.string().min(2).max(100).trim().optional(),
  role: z.enum(['buyer', 'seller', 'both']).default('buyer'),
});

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required'),
});

const googleOAuthSchema = z.object({
  // Accept either an id_token (Google credential/One Tap) or
  // an access_token (implicit popup flow from @react-oauth/google)
  id_token:     z.string().min(1).optional(),
  access_token: z.string().min(1).optional(),
  role: z.enum(['buyer', 'seller', 'both']).default('buyer'),
}).refine(
  (d) => d.id_token || d.access_token,
  { message: 'Either id_token or access_token is required' }
);


const appleOAuthSchema = z.object({
  identity_token: z.string().min(1, 'Apple identity token is required'),
  full_name: z.string().max(100).optional(),
  role: z.enum(['buyer', 'seller', 'both']).default('buyer'),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
  email: emailField,
});

const resendVerificationSchema = z.object({
  email: emailField,
});

const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

const forgotPasswordSchema = z.object({
  email: emailField,
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  email: emailField,
  new_password: passwordField,
});

const phoneVerifyRequestSchema = z.object({
  phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (+1234567890)'),
});

const phoneVerifyConfirmSchema = z.object({
  phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format'),
  otp: z
    .string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d+$/, 'OTP must be numeric'),
});

const completeProfileSchema = z.object({
  username: usernameField,
  full_name: z.string().min(2).max(100).trim().optional(),
  role: z.enum(['buyer', 'seller', 'both']),
  location_city: z.string().max(100).optional(),
  location_lat: z.number().min(-90).max(90).optional(),
  location_lng: z.number().min(-180).max(180).optional(),
});

module.exports = {
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
};