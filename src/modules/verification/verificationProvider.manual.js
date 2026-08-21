'use strict';

const { v4: uuidv4 } = require('uuid');
const AppError = require('../../shared/errors/AppError');
const logger = require('../../shared/utils/logger');
const appConfig = require('../../config/app.config');
const {
  encrypt,
  generateDocumentHash,
  validateDocumentImage,
} = require('./verification.utils');

class ManualVerificationProvider {
  constructor(supabase, repo) {
    this.supabase = supabase;
    this.repo = repo;
  }

  /**
   * Check verification state for a seller
   */
  async checkVerifiedStatus(userId) {
    const { data: user, error } = await this.supabase
      .from('users')
      .select('seller_verification_status')
      .eq('id', userId)
      .single();

    if (error) {
      logger.error({ error, userId }, 'checkVerifiedStatus failed');
      return false;
    }

    return user.seller_verification_status === 'identity_verified';
  }

  /**
   * Submit seller identification documents manually
   */
  async submitVerification(userId, data, files) {
    // 1. Check existing verification status
    const latest = await this.repo.findLatestByUserId(userId);
    if (latest && latest.status === 'pending') {
      throw new AppError(
        'You already have a pending verification request in review.',
        400,
        'PENDING_VERIFICATION'
      );
    }

    // 2. Validate upload files & calculate fingerprint hash
    const { id_front, id_back, selfie } = files;
    if (!id_front || !selfie) {
      throw new AppError('Front of ID document and selfie are required files.', 400);
    }

    await validateDocumentImage(id_front, 'ID Front');
    await validateDocumentImage(selfie, 'Selfie');
    if (id_back) {
      await validateDocumentImage(id_back, 'ID Back');
    }

    const idBuffer = id_front.buffer;
    const documentHash = generateDocumentHash(idBuffer);

    // 3. Duplicate Document Check
    const duplicate = await this.repo.findDuplicateHash(documentHash, userId);
    let duplicateDetected = false;
    if (duplicate) {
      duplicateDetected = true;
      logger.warn(
        { userId, duplicateUserId: duplicate.user_id, documentHash },
        'Duplicate document fingerprint hash detected'
      );
    }

    // 4. Encrypt sensitive fields
    const encryptedName = encrypt(data.full_legal_name, 'v1');
    const encryptedDob = encrypt(data.date_of_birth, 'v1');

    const verificationId = uuidv4();
    const storageBucket = appConfig.storage.bucket;

    // 5. Upload files to private folders
    const frontPath = `seller-verification/${userId}/${verificationId}/front.webp`;
    const selfiePath = `seller-verification/${userId}/${verificationId}/selfie.webp`;
    let backPath = null;

    const frontUpload = this.supabase.storage
      .from(storageBucket)
      .upload(frontPath, id_front.buffer, { contentType: id_front.mimetype });

    const selfieUpload = this.supabase.storage
      .from(storageBucket)
      .upload(selfiePath, selfie.buffer, { contentType: selfie.mimetype });

    const uploads = [frontUpload, selfieUpload];

    if (id_back) {
      backPath = `seller-verification/${userId}/${verificationId}/back.webp`;
      const backUpload = this.supabase.storage
        .from(storageBucket)
        .upload(backPath, id_back.buffer, { contentType: id_back.mimetype });
      uploads.push(backUpload);
    }

    const uploadResults = await Promise.all(uploads);
    const hasUploadErrors = uploadResults.some((res) => res.error);
    if (hasUploadErrors) {
      logger.error({ uploadResults }, 'Verification file upload to Supabase storage failed');
      throw new AppError('Failed to upload verification documents.', 500);
    }

    const cdnBase = appConfig.cdn.baseUrl || `${process.env.SUPABASE_URL}/storage/v1/object/public`;
    const idFrontUrl = `${cdnBase}/${storageBucket}/${frontPath}`;
    const selfieUrl = `${cdnBase}/${storageBucket}/${selfiePath}`;
    const idBackUrl = backPath ? `${cdnBase}/${storageBucket}/${backPath}` : null;

    // 6. Save attempt count
    const attemptCount = await this.repo.countAttemptsByUserId(userId);

    // 7. Write records to DB
    const verificationRecord = await this.repo.createSubmission({
      id: verificationId,
      user_id: userId,
      status: 'pending',
      verification_method: 'manual',
      verification_version: 1,
      attempt_number: attemptCount + 1,
      verification_metadata: { duplicate_detected: duplicateDetected },
      encrypted_full_legal_name: encryptedName,
      encrypted_date_of_birth: encryptedDob,
      id_type: data.id_type,
      document_hash: documentHash,
      document_expiration_date: data.document_expiration_date,
      id_front_url: idFrontUrl,
      id_back_url: idBackUrl,
      selfie_url: selfieUrl,
    });

    // 8. Set user's seller_verification_status to pending
    const { error: userErr } = await this.supabase
      .from('users')
      .update({ seller_verification_status: 'pending' })
      .eq('id', userId);

    if (userErr) {
      logger.error({ userErr, userId }, 'Failed to update user verification status');
      throw new AppError('Failed to update verification status', 500);
    }

    return {
      verification_id: verificationId,
      status: 'pending',
      attempt_number: attemptCount + 1,
    };
  }
}

module.exports = ManualVerificationProvider;
