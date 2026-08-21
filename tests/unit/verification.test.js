'use strict';

const VerificationEngine = require('../../src/modules/verification/verificationEngine');
const VerificationService = require('../../src/modules/verification/verification.service');
const StoreService = require('../../src/modules/stores/store.service');
const ForbiddenError = require('../../src/shared/errors/ForbiddenError');
const AppError = require('../../src/shared/errors/AppError');
const { encrypt, decrypt } = require('../../src/modules/verification/verification.utils');

// Mock sharp image library
jest.mock('sharp', () => {
  return jest.fn().mockImplementation(() => {
    return {
      metadata: jest.fn().mockResolvedValue({ width: 800, height: 800 }),
    };
  });
});

describe('Seller Verification System Unit Tests', () => {
  let mockSupabase;
  let mockRedis;
  let mockVerificationRepo;
  let verificationService;

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.VERIFICATION_ENCRYPTION_KEY = 'test_encryption_key_32_bytes_long_!!!';

    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      rpc: jest.fn().mockResolvedValue({ data: {}, error: null }),
      storage: {
        from: jest.fn().mockReturnThis(),
        upload: jest.fn().mockResolvedValue({ data: { path: 'path' }, error: null }),
      },
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    verificationService = new VerificationService(mockSupabase, mockRedis);
    mockVerificationRepo = verificationService.repo;
  });

  describe('PII Encryption Utilities', () => {
    it('should encrypt and decrypt full legal name and date of birth correctly', () => {
      const plaintext = 'Shawkat Siddeqi';
      const ciphertext = encrypt(plaintext, 'v1');
      
      expect(ciphertext).not.toBe(plaintext);
      expect(ciphertext.split(':')).toHaveLength(4); // ciphertext:iv:tag:keyVersion
      
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it('should safely return original value on decrypting plain/legacy text', () => {
      const legacyText = 'Plaintext Legal Name';
      const decrypted = decrypt(legacyText);
      expect(decrypted).toBe(legacyText);
    });
  });

  describe('VerificationEngine & manualProvider checkVerifiedStatus', () => {
    it('should return true if user status is identity_verified', async () => {
      mockSupabase.single.mockResolvedValue({
        data: { seller_verification_status: 'identity_verified' },
        error: null,
      });

      const provider = verificationService.manualProvider;
      const engine = new VerificationEngine(provider);
      
      const verified = await engine.isVerified('user-123');
      expect(verified).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('users');
    });

    it('should return false if user status is pending/none/rejected', async () => {
      mockSupabase.single.mockResolvedValue({
        data: { seller_verification_status: 'pending' },
        error: null,
      });

      const provider = verificationService.manualProvider;
      const engine = new VerificationEngine(provider);
      
      const verified = await engine.isVerified('user-123');
      expect(verified).toBe(false);
    });
  });

  describe('StoreService Store Creation Gate', () => {
    let storeService;
    let mockStoreRepo;

    beforeEach(() => {
      storeService = new StoreService(mockSupabase, mockRedis);
      mockStoreRepo = storeService.repo;

      // Mock StoreRepo
      mockStoreRepo.findStoreByUserId = jest.fn().mockResolvedValue(null);
      mockStoreRepo.createStore = jest.fn().mockResolvedValue({ id: 'store-123' });
    });

    it('should throw ForbiddenError with code VERIFICATION_REQUIRED and save draft if seller is not verified', async () => {
      // Mock verificationEngine.isVerified to false
      storeService.verificationEngine.isVerified = jest.fn().mockResolvedValue(false);
      storeService.verificationRepo.saveStoreDraft = jest.fn().mockResolvedValue({ id: 'draft-123' });

      const storeData = { store_name: 'Test Store Name' };

      await expect(
        storeService.createStore('user-123', 'seller', storeData)
      ).rejects.toThrow(ForbiddenError);

      expect(storeService.verificationRepo.saveStoreDraft).toHaveBeenCalledWith('user-123', storeData);
      expect(mockStoreRepo.createStore).not.toHaveBeenCalled();
    });

    it('should successfully create store if seller is verified', async () => {
      storeService.verificationEngine.isVerified = jest.fn().mockResolvedValue(true);

      const storeData = { store_name: 'Test Store Name' };
      const store = await storeService.createStore('user-123', 'seller', storeData);

      expect(store.id).toBe('store-123');
      expect(mockStoreRepo.createStore).toHaveBeenCalled();
    });
  });

  describe('VerificationService submitVerification', () => {
    it('should encrypt PII and submit verification successfully', async () => {
      // Mock no pending submissions
      jest.spyOn(mockVerificationRepo, 'findLatestByUserId').mockResolvedValue(null);
      jest.spyOn(mockVerificationRepo, 'findDuplicateHash').mockResolvedValue(null);
      jest.spyOn(mockVerificationRepo, 'countAttemptsByUserId').mockResolvedValue(0);
      
      const mockRecord = { id: 'verif-123', attempt_number: 1, status: 'pending' };
      jest.spyOn(mockVerificationRepo, 'createSubmission').mockResolvedValue(mockRecord);
      
      // Mock user update
      mockSupabase.eq.mockResolvedValue({ data: {}, error: null });

      const files = {
        id_front: { buffer: Buffer.from('test_image_front'), mimetype: 'image/jpeg', filename: 'front.jpg' },
        selfie: { buffer: Buffer.from('test_image_selfie'), mimetype: 'image/jpeg', filename: 'selfie.jpg' },
      };

      const submitData = {
        full_legal_name: 'Shawkat Siddeqi',
        date_of_birth: '1995-05-15',
        id_type: 'passport',
        document_expiration_date: '2030-01-01',
      };

      const result = await verificationService.submitVerification('user-123', submitData, files);
      expect(result.status).toBe('pending');
      expect(result.attempt_number).toBe(1);
      
      expect(mockVerificationRepo.createSubmission).toHaveBeenCalled();
      const insertArg = mockVerificationRepo.createSubmission.mock.calls[0][0];
      
      // Verify values are encrypted
      expect(insertArg.encrypted_full_legal_name).not.toBe(submitData.full_legal_name);
      expect(decrypt(insertArg.encrypted_full_legal_name)).toBe(submitData.full_legal_name);
    });
  });

  describe('VerificationService reviewVerification transaction', () => {
    it('should trigger review_seller_verification_transaction RPC and send notifications', async () => {
      jest.spyOn(mockVerificationRepo, 'findSubmissionById').mockResolvedValue({
        id: 'verif-123',
        status: 'pending',
        user_id: 'user-123',
      });

      const rpcResult = {
        success: true,
        verification_id: 'verif-123',
        user_id: 'user-123',
        new_status: 'identity_verified',
        store_created: true,
        store_id: 'store-123',
        audit_id: 'audit-123',
      };
      mockSupabase.rpc.mockResolvedValue({ data: rpcResult, error: null });

      // Mock notifications
      verificationService.notificationService.createNotification = jest.fn().mockResolvedValue({});

      const result = await verificationService.reviewVerification(
        'admin-123',
        'verif-123',
        'approved',
        null,
        '127.0.0.1',
        'Looks good'
      );

      expect(result.success).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('review_seller_verification_transaction', {
        p_verification_id: 'verif-123',
        p_reviewer_id: 'admin-123',
        p_status: 'approved',
        p_rejection_reason: null,
        p_ip_address: '127.0.0.1',
        p_notes: 'Looks good',
      });
      
      // Confirm notification is triggered post-commit
      expect(verificationService.notificationService.createNotification).toHaveBeenCalledWith({
        userId: 'user-123',
        type: 'verification_approved',
        title: 'Identity Verified Successfully',
        body: expect.any(String),
        data: { verificationId: 'verif-123', storeId: 'store-123' },
      });
    });
  });
});
