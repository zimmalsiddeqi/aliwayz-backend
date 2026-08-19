'use strict';

const expireQRTokensJob = require('../../src/jobs/expireQRTokens.job');
const cleanupSoldProductsJob = require('../../src/jobs/cleanupSoldProducts.job');

describe('Background Jobs Batch Optimization Verification', () => {
  let mockSupabase;
  let mockRedis;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSupabase = {
      rpc: jest.fn(),
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
    };

    mockRedis = {
      del: jest.fn().mockResolvedValue(1),
    };
  });

  describe('expireQRTokensJob', () => {
    test('should invoke database rpc exactly once to batch expire QR tokens and revert products', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: 5, error: null }); // 5 products reverted

      await expireQRTokensJob(mockSupabase, mockRedis);

      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('expire_stale_qr_tokens');
    });
  });

  describe('cleanupSoldProductsJob', () => {
    test('should fetch IDs, call rpc, and delete all Redis cache keys in parallel', async () => {
      const products = [
        { id: 'p-1', title: 'Product 1' },
        { id: 'p-2', title: 'Product 2' },
      ];

      // Mock fetching expired sold products
      mockSupabase.then = jest.fn((onFulfilled) => {
        onFulfilled({ data: products, error: null });
      });

      // Mock database RPC
      mockSupabase.rpc.mockResolvedValue({ data: 2, error: null });

      await cleanupSoldProductsJob(mockSupabase, mockRedis);

      // Verify DB RPC executed
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('auto_remove_sold_products');

      // Verify all product and feed caches deleted
      expect(mockRedis.del).toHaveBeenCalledTimes(4); // 2 products + 2 feeds (trending & recent)
      expect(mockRedis.del).toHaveBeenCalledWith('product:p-1');
      expect(mockRedis.del).toHaveBeenCalledWith('product:p-2');
      expect(mockRedis.del).toHaveBeenCalledWith('feed:trending');
      expect(mockRedis.del).toHaveBeenCalledWith('feed:recent');
    });

    test('should not call database rpc if no products require cleanup', async () => {
      // Mock no products to clean up
      mockSupabase.then = jest.fn((onFulfilled) => {
        onFulfilled({ data: [], error: null });
      });

      await cleanupSoldProductsJob(mockSupabase, mockRedis);

      // Verify RPC and Redis calls were not triggered since there's no work
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });
});
