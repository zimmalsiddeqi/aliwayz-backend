'use strict';

const buildApp = require('../../src/app');
const ChatGateway = require('../../src/modules/chat/chat.gateway');
const ProductService = require('../../src/modules/products/product.service');
const logger = require('../../src/shared/utils/logger');

// Mock logger.error to verify redaction behavior
jest.mock('../../src/shared/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

describe('Security and Validation Fixes Verification', () => {
  describe('Global Error Handler Redaction', () => {
    let app;

    beforeAll(async () => {
      app = await buildApp();
    });

    afterAll(async () => {
      await app.close();
    });

    test('should redact plain-text passwords and tokens in the error logs', async () => {
      // Force a 500 error on a route
      app.post('/test-error-log', async (request, reply) => {
        throw new Error('Test unhandled exception');
      });

      // Execute request with sensitive credentials in body
      await app.inject({
        method: 'POST',
        url: '/test-error-log',
        payload: {
          username: 'securityuser',
          password: 'supersecretpassword123',
          token: 'active_session_token_xyz',
        },
      });

      // Verify logger.error was called with the redacted body
      expect(logger.error).toHaveBeenCalled();
      const lastCallArgs = logger.error.mock.calls[logger.error.mock.calls.length - 1][0];
      
      expect(lastCallArgs.body).toBeDefined();
      expect(lastCallArgs.body.password).toBe('[REDACTED]');
      expect(lastCallArgs.body.token).toBe('[REDACTED]');
      expect(lastCallArgs.body.username).toBe('securityuser');
    });
  });

  describe('Socket.IO Typing Event Spoofing Prevention', () => {
    let mockIo;
    let mockRedis;
    let mockSocket;
    let chatGateway;

    beforeEach(() => {
      jest.clearAllMocks();

      mockIo = {
        use: jest.fn(),
        on: jest.fn(),
      };

      mockRedis = {
        client: {
          options: {},
        },
      };

      chatGateway = new ChatGateway(mockIo, {}, mockRedis, {});

      mockSocket = {
        user: {
          id: 'user-456',
          username: 'chatseller',
        },
        rooms: new Set(), // Simulates socket.rooms in Socket.io
        to: jest.fn().mockReturnValue({
          emit: jest.fn(),
        }),
      };
    });

    test('should NOT emit typing events if the socket is not in the conversation room', () => {
      const data = { conversationId: 'conv-private-999' };

      // Attempt typing start without joining
      chatGateway._handleTypingStart(mockSocket, data);

      // Verify that socket.to was never called since it is not in the room Set
      expect(mockSocket.to).not.toHaveBeenCalled();
    });

    test('should emit typing events if the socket is a member of the conversation room', () => {
      const conversationId = 'conv-private-999';
      const data = { conversationId };

      // Simulate joining the room
      mockSocket.rooms.add(`conversation:${conversationId}`);

      // Attempt typing start
      chatGateway._handleTypingStart(mockSocket, data);

      // Verify that socket.to was called with the correct room
      expect(mockSocket.to).toHaveBeenCalledWith(`conversation:${conversationId}`);
    });
  });

  describe('Product Search Query String Parameter Sanitization', () => {
    let mockRepo;
    let productService;

    beforeEach(() => {
      mockRepo = {
        browseProducts: jest.fn().mockResolvedValue({ data: [], count: 0 }),
      };
      productService = new ProductService({}, {});
      productService.repo = mockRepo;
    });

    test('should convert invalid string and negative query parameters to undefined', async () => {
      const query = {
        min_price: 'abc', // Invalid
        max_price: '-50', // Negative
        radius_km: 'invalid_float', // Invalid
        lat: '40.7128', // Valid
        lng: 'invalid_lng', // Invalid
      };

      await productService.browseProducts(query);

      // Verify arguments passed to repo.browseProducts
      const calledArgs = mockRepo.browseProducts.mock.calls[0][0];

      expect(calledArgs.minPrice).toBeUndefined();
      expect(calledArgs.maxPrice).toBeUndefined();
      expect(calledArgs.radiusKm).toBeUndefined();
      expect(calledArgs.lat).toBe(40.7128);
      expect(calledArgs.lng).toBeUndefined();
    });
  });
});
