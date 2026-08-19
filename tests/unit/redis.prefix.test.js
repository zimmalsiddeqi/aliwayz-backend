'use strict';

const ChatGateway = require('../../src/modules/chat/chat.gateway');
const SearchService = require('../../src/modules/search/search.service');

describe('Redis Key Double Prefixing Fix Verification', () => {
  let mockRedis;
  let mockIo;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedis = {
      client: {
        options: {
          keyPrefix: 'marketplace:',
        },
        sadd: jest.fn().mockResolvedValue(1),
        srem: jest.fn().mockResolvedValue(1),
        zrevrange: jest.fn().mockResolvedValue([]),
        zincrby: jest.fn().mockResolvedValue('1'),
        zremrangebyrank: jest.fn().mockResolvedValue(0),
      },
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
  });

  describe('ChatGateway Room Members Tracking', () => {
    let chatGateway;
    let mockSocket;
    let mockChatService;

    beforeEach(() => {
      mockChatService = {
        repo: {
          isParticipant: jest.fn().mockResolvedValue(true),
          markMessagesRead: jest.fn().mockResolvedValue(),
        },
      };

      chatGateway = new ChatGateway(mockIo, {}, mockRedis, {});
      chatGateway.chatService = mockChatService;
      
      mockSocket = {
        user: {
          id: 'user-789',
          username: 'chatseller',
        },
        join: jest.fn().mockResolvedValue(),
        leave: jest.fn().mockResolvedValue(),
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
    });

    test('should sadd to "conv:members:conversationId" without manual prefixing', async () => {
      const conversationId = 'conv-123';
      
      // Invoke handle join
      await chatGateway._handleJoinConversation(mockSocket, { conversationId });

      // Verify the key does NOT contain manual prefix 'marketplace:'
      expect(mockRedis.client.sadd).toHaveBeenCalledWith(
        'conv:members:conv-123',
        'user-789'
      );
    });

    test('should srem from "conv:members:conversationId" without manual prefixing', async () => {
      const conversationId = 'conv-123';
      
      // Invoke handle leave
      await chatGateway._handleLeaveConversation(mockSocket, { conversationId });

      // Verify the key does NOT contain manual prefix 'marketplace:'
      expect(mockRedis.client.srem).toHaveBeenCalledWith(
        'conv:members:conv-123',
        'user-789'
      );
    });
  });

  describe('SearchService Popular Searches Tracking', () => {
    let searchService;
    let mockRepo;

    beforeEach(() => {
      mockRepo = {};
      searchService = new SearchService(mockRepo, mockRedis);
    });

    test('should zrevrange "search:popular:zset" without manual prefixing', async () => {
      mockRedis.get.mockResolvedValue(null); // Force database query
      
      await searchService.getPopularSearches(10);

      // Verify the key does NOT contain manual prefix 'marketplace:'
      expect(mockRedis.client.zrevrange).toHaveBeenCalledWith(
        'search:popular:zset',
        0,
        9,
        'WITHSCORES'
      );
    });

    test('should zincrby and zremrangebyrank "search:popular:zset" without manual prefixing', async () => {
      const searchQuery = 'iPhone 15';

      await searchService._incrementPopularSearch(searchQuery);

      // Verify zincrby uses key without manual prefix
      expect(mockRedis.client.zincrby).toHaveBeenCalledWith(
        'search:popular:zset',
        1,
        'iphone 15'
      );

      // Verify zremrangebyrank uses key without manual prefix
      expect(mockRedis.client.zremrangebyrank).toHaveBeenCalledWith(
        'search:popular:zset',
        0,
        -101
      );
    });
  });
});
