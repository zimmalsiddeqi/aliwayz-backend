'use strict';

const { authenticate, optionalAuthenticate } = require('../../src/middleware/authenticate');
const AppError = require('../../src/shared/errors/AppError');
const UnauthorizedError = require('../../src/shared/errors/UnauthorizedError');

describe('Authentication Middleware Fail-Closed Verification', () => {
  let mockRequest;
  let mockReply;

  beforeEach(() => {
    mockRequest = {
      jwtVerify: jest.fn().mockResolvedValue(),
      user: {
        id: 'user-123',
        email: 'user@example.com',
        role: 'buyer',
        username: 'testuser',
      },
      headers: {
        authorization: 'Bearer valid_token',
      },
      server: {
        supabase: {
          from: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn(),
        },
      },
      ip: '127.0.0.1',
      url: '/test-route',
    };

    mockReply = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
  });

  describe('authenticate', () => {
    test('should succeed if user exists and is active in DB', async () => {
      mockRequest.server.supabase.maybeSingle.mockResolvedValue({
        data: {
          id: 'user-123',
          role: 'buyer',
          account_status: 'active',
          email_verified: true,
          username: 'testuser',
        },
        error: null,
      });

      await expect(authenticate(mockRequest, mockReply)).resolves.not.toThrow();
      expect(mockRequest.user.account_status).toBe('active');
      expect(mockRequest.user.email_verified).toBe(true);
    });

    test('should fail closed (throw 503 AppError) if DB lookup errors out', async () => {
      mockRequest.server.supabase.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'Database connection timeout', code: '57P01' },
      });

      await expect(authenticate(mockRequest, mockReply)).rejects.toThrow(AppError);
      try {
        await authenticate(mockRequest, mockReply);
      } catch (err) {
        expect(err.statusCode).toBe(503);
        expect(err.code).toBe('AUTH_SERVICE_UNAVAILABLE');
        expect(err.message).toBe('Authentication service temporarily unavailable');
      }
    });

    test('should throw 403 AppError if user account is banned in DB', async () => {
      mockRequest.server.supabase.maybeSingle.mockResolvedValue({
        data: {
          id: 'user-123',
          role: 'buyer',
          account_status: 'banned',
          email_verified: true,
          username: 'testuser',
        },
        error: null,
      });

      await expect(authenticate(mockRequest, mockReply)).rejects.toThrow(AppError);
      try {
        await authenticate(mockRequest, mockReply);
      } catch (err) {
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe('ACCOUNT_BANNED');
      }
    });
  });

  describe('optionalAuthenticate', () => {
    test('should populate user if token is valid and DB query succeeds', async () => {
      mockRequest.server.supabase.maybeSingle.mockResolvedValue({
        data: {
          id: 'user-123',
          role: 'buyer',
          account_status: 'active',
          username: 'testuser',
        },
        error: null,
      });

      await optionalAuthenticate(mockRequest);
      expect(mockRequest.user).toBeDefined();
      expect(mockRequest.user.role).toBe('buyer');
    });

    test('should fail closed (throw 503 AppError) if token is valid but DB query fails', async () => {
      mockRequest.server.supabase.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'Supabase connection failure' },
      });

      await expect(optionalAuthenticate(mockRequest)).rejects.toThrow(AppError);
      try {
        await optionalAuthenticate(mockRequest);
      } catch (err) {
        expect(err.statusCode).toBe(503);
        expect(err.code).toBe('AUTH_SERVICE_UNAVAILABLE');
      }
    });

    test('should silently degrade to guest (user = null) if token signature is invalid', async () => {
      mockRequest.jwtVerify.mockRejectedValue(new Error('Invalid signature'));
      
      await expect(optionalAuthenticate(mockRequest)).resolves.not.toThrow();
      expect(mockRequest.user).toBeNull();
    });

    test('should silently degrade to guest (user = null) if token is missing', async () => {
      mockRequest.headers.authorization = undefined;

      await expect(optionalAuthenticate(mockRequest)).resolves.not.toThrow();
      expect(mockRequest.user).toBeNull();
    });
  });
});
