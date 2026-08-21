'use strict';

const VerificationRepository = require('./verification.repository');
const ManualVerificationProvider = require('./verificationProvider.manual');
const NotificationService = require('../notifications/notification.service');
const AppError = require('../../shared/errors/AppError');
const logger = require('../../shared/utils/logger');
const { decrypt } = require('./verification.utils');

const VERIFICATION_TEMPLATES = {
  SUBMITTED: {
    title: 'Verification In Review',
    body: 'Your identity document submission is being evaluated by our compliance team.',
    type: 'verification_submitted',
  },
  APPROVED: {
    title: 'Identity Verified Successfully',
    body: 'Congratulations! Your seller identity verification was approved. You can now build your Store.',
    type: 'verification_approved',
  },
  REJECTED: {
    title: 'Verification Rejected',
    body: (reason) => `Identity verification failed: ${reason}. Please update and resubmit your details.`,
    type: 'verification_rejected',
  },
};

class VerificationService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new VerificationRepository(supabase);
    this.manualProvider = new ManualVerificationProvider(supabase, this.repo);
    this.notificationService = new NotificationService(supabase, redis);
  }

  /**
   * Retrieve verification details for current user profile
   */
  async getVerificationStatus(userId) {
    const latest = await this.repo.findLatestByUserId(userId);

    const { data: user } = await this.supabase
      .from('users')
      .select('seller_verification_status')
      .eq('id', userId)
      .maybeSingle();

    const userStatus = user?.seller_verification_status || 'none';

    if (!latest) {
      return { status: userStatus, latest_submission: null };
    }

    // Decrypt details for authorized self-view
    const decryptedRecord = {
      ...latest,
      full_legal_name: decrypt(latest.encrypted_full_legal_name),
      date_of_birth: latest.encrypted_date_of_birth,
    };
    
    // Remove encrypted binary strings
    delete decryptedRecord.encrypted_full_legal_name;
    delete decryptedRecord.encrypted_date_of_birth;

    const effectiveStatus =
      userStatus === 'identity_verified' || latest.status === 'approved'
        ? 'identity_verified'
        : userStatus !== 'none'
        ? userStatus
        : latest.status;

    return {
      status: effectiveStatus,
      latest_submission: decryptedRecord,
    };
  }

  /**
   * Submit seller identification documents
   */
  async submitVerification(userId, data, files) {
    const result = await this.manualProvider.submitVerification(userId, data, files);

    // Send submitted notification
    try {
      const template = VERIFICATION_TEMPLATES.SUBMITTED;
      await this.notificationService.createNotification({
        userId,
        type: template.type,
        title: template.title,
        body: template.body,
        data: { verificationId: result.verification_id },
      });
    } catch (err) {
      logger.warn({ err, userId }, 'Verification submitted notification failed');
    }

    return result;
  }

  /**
   * Admin verification action (atomic transaction RPC)
   */
  async reviewVerification(adminId, submissionId, status, rejectionReason, ipAddress, notes) {
    const submission = await this.repo.findSubmissionById(submissionId);
    if (!submission) {
      throw new AppError('Verification submission not found', 404);
    }

    if (submission.status !== 'pending') {
      throw new AppError('Verification request has already been reviewed', 400);
    }

    // Invoke atomic SQL transaction RPC
    const { data, error } = await this.supabase.rpc('review_seller_verification_transaction', {
      p_verification_id: submissionId,
      p_reviewer_id: adminId,
      p_status: status,
      p_rejection_reason: rejectionReason || null,
      p_ip_address: ipAddress || null,
      p_notes: notes || null,
    });

    if (error) {
      logger.error({ error, submissionId }, 'review_seller_verification_transaction failed');
      throw new AppError('Failed to complete verification review transaction', 500);
    }

    // Post-Commit Notifications
    try {
      const userId = data.user_id;
      if (status === 'approved') {
        const template = VERIFICATION_TEMPLATES.APPROVED;
        await this.notificationService.createNotification({
          userId,
          type: template.type,
          title: template.title,
          body: template.body,
          data: { verificationId: submissionId, storeId: data.store_id || null },
        });
      } else {
        const template = VERIFICATION_TEMPLATES.REJECTED;
        await this.notificationService.createNotification({
          userId,
          type: template.type,
          title: template.title,
          body: template.body(rejectionReason),
          data: { verificationId: submissionId, reason: rejectionReason },
        });
      }
    } catch (err) {
      logger.warn({ err, submissionId }, 'Verification review notification failed');
    }

    return data;
  }
}

module.exports = VerificationService;
