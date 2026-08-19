'use strict';

const ProductService = require('../../src/modules/products/product.service');
const AppError = require('../../src/shared/errors/AppError');
const NotFoundError = require('../../src/shared/errors/NotFoundError');
const ForbiddenError = require('../../src/shared/errors/ForbiddenError');

// Mock dependencies
const sharp = require('sharp');
jest.mock('sharp', () => {
  const mSharp = {
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-resized-buffer')),
  };
  return jest.fn(() => mSharp);
});

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

describe('Product Service — Image Thumbnail Upload & Deletion', () => {
  let productService;
  let mockRepo;
  let mockSupabase;
  let mockRedis;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRepo = {
      findProductById: jest.fn(),
      countProductImages: jest.fn(),
      addProductImage: jest.fn(),
      findProductImage: jest.fn(),
      deleteProductImage: jest.fn(),
    };

    mockSupabase = {
      storage: {
        from: jest.fn().mockReturnThis(),
        upload: jest.fn(),
        remove: jest.fn(),
      },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn(),
      update: jest.fn().mockReturnThis(),
    };

    mockRedis = {
      del: jest.fn().mockResolvedValue(1),
    };

    productService = new ProductService(mockSupabase, mockRedis);
    productService.repo = mockRepo;
  });

  describe('uploadProductImages', () => {
    const sellerId = 'seller-123';
    const productId = 'product-123';
    const files = [
      {
        buffer: Buffer.from('test-image-data'),
        mimetype: 'image/jpeg',
      },
    ];

    test('should successfully resize, upload both images and save URLs', async () => {
      mockRepo.findProductById.mockResolvedValue({
        id: productId,
        users: { id: sellerId },
      });
      mockRepo.countProductImages.mockResolvedValue(0);
      mockSupabase.storage.upload.mockResolvedValue({ error: null });
      mockRepo.addProductImage.mockResolvedValue({
        id: 'img-123',
        cdn_url: 'cdn/main.webp',
        storage_url: 'storage/main.webp',
        thumbnail_cdn_url: 'cdn/thumb.webp',
        thumbnail_storage_url: 'storage/thumb.webp',
      });

      const result = await productService.uploadProductImages(sellerId, productId, files);

      expect(mockRepo.findProductById).toHaveBeenCalledWith(productId);
      expect(sharp).toHaveBeenCalledWith(files[0].buffer);
      
      // Should resize twice (once for 800x800, once for 300x300)
      const sharpInstance = sharp();
      expect(sharpInstance.resize).toHaveBeenCalledWith(800, 800, expect.any(Object));
      expect(sharpInstance.resize).toHaveBeenCalledWith(300, 300, expect.any(Object));

      // Should upload main and thumbnail images
      expect(mockSupabase.storage.upload).toHaveBeenCalledWith(
        'products/product-123/mock-uuid.webp',
        expect.any(Buffer),
        expect.any(Object)
      );
      expect(mockSupabase.storage.upload).toHaveBeenCalledWith(
        'products/product-123/thumbnails/mock-uuid.webp',
        expect.any(Buffer),
        expect.any(Object)
      );

      // Should add to database
      expect(mockRepo.addProductImage).toHaveBeenCalledWith(productId, {
        storage_url: expect.stringContaining('mock-uuid.webp'),
        cdn_url: expect.stringContaining('mock-uuid.webp'),
        thumbnail_storage_url: expect.stringContaining('thumbnails/mock-uuid.webp'),
        thumbnail_cdn_url: expect.stringContaining('thumbnails/mock-uuid.webp'),
        display_order: 0,
        is_primary: true,
      });

      expect(result).toHaveLength(1);
      expect(result[0].thumbnail_cdn_url).toBe('cdn/thumb.webp');
      expect(mockRedis.del).toHaveBeenCalled();
    });

    test('should rollback main image upload if thumbnail upload fails', async () => {
      mockRepo.findProductById.mockResolvedValue({
        id: productId,
        users: { id: sellerId },
      });
      mockRepo.countProductImages.mockResolvedValue(0);
      
      // First upload succeeds, second upload fails
      mockSupabase.storage.upload
        .mockResolvedValueOnce({ error: null }) // Main image
        .mockResolvedValueOnce({ error: new Error('S3 Connection Failed') }); // Thumbnail

      mockSupabase.storage.remove.mockResolvedValue({ error: null });

      await expect(
        productService.uploadProductImages(sellerId, productId, files)
      ).rejects.toThrow(AppError);

      // Verify rollback occurred
      expect(mockSupabase.storage.remove).toHaveBeenCalledWith([
        'products/product-123/mock-uuid.webp',
      ]);
      expect(mockRepo.addProductImage).not.toHaveBeenCalled();
    });
  });

  describe('deleteProductImage', () => {
    const sellerId = 'seller-123';
    const productId = 'product-123';
    const imageId = 'img-123';

    test('should delete both main and thumbnail images from storage and remove DB record', async () => {
      mockRepo.findProductById.mockResolvedValue({
        id: productId,
        users: { id: sellerId },
      });
      mockRepo.findProductImage.mockResolvedValue({
        id: imageId,
        storage_url: 'https://supabase.co/storage/v1/object/public/marketplace-media/products/product-123/img.webp',
        thumbnail_storage_url: 'https://supabase.co/storage/v1/object/public/marketplace-media/products/product-123/thumbnails/img.webp',
        is_primary: false,
      });
      mockSupabase.storage.remove.mockResolvedValue({ error: null });
      mockRepo.deleteProductImage.mockResolvedValue();

      await productService.deleteProductImage(sellerId, productId, imageId);

      expect(mockRepo.findProductImage).toHaveBeenCalledWith(imageId, productId);
      
      // Verify both files deleted from storage
      expect(mockSupabase.storage.remove).toHaveBeenCalledWith([
        'products/product-123/img.webp',
        'products/product-123/thumbnails/img.webp',
      ]);

      expect(mockRepo.deleteProductImage).toHaveBeenCalledWith(imageId);
    });

    test('should work correctly and be backward compatible if thumbnail_storage_url is missing', async () => {
      mockRepo.findProductById.mockResolvedValue({
        id: productId,
        users: { id: sellerId },
      });
      mockRepo.findProductImage.mockResolvedValue({
        id: imageId,
        storage_url: 'https://supabase.co/storage/v1/object/public/marketplace-media/products/product-123/img.webp',
        thumbnail_storage_url: null, // Legacy image
        is_primary: false,
      });
      mockSupabase.storage.remove.mockResolvedValue({ error: null });
      mockRepo.deleteProductImage.mockResolvedValue();

      await productService.deleteProductImage(sellerId, productId, imageId);

      // Verify only main file deleted from storage
      expect(mockSupabase.storage.remove).toHaveBeenCalledWith([
        'products/product-123/img.webp',
      ]);
      expect(mockRepo.deleteProductImage).toHaveBeenCalledWith(imageId);
    });
  });
});
