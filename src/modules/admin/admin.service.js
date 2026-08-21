'use strict';

const AdminRepository = require('./admin.repository');
const NotificationService = require('../notifications/notification.service');
const VerificationService = require('../verification/verification.service');
const { getPaginationParams } = require('../../shared/utils/paginate');
const { CACHE_KEYS } = require('../../shared/constants/cacheKeys');
const logger = require('../../shared/utils/logger');

const AppError = require('../../shared/errors/AppError');

class AdminService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new AdminRepository(supabase);
    this.notificationService = new NotificationService(supabase, redis);
    this.verificationService = new VerificationService(supabase, redis);
  }

  // ─────────────────────────────────────────
  // DASHBOARD ANALYTICS
  // ─────────────────────────────────────────
  async getDashboard() {
    const cacheKey = 'admin:dashboard:stats';
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const stats = await this.repo.getDashboardStats();
    await this.redis.set(cacheKey, stats, 300); // 5 min cache

    return stats;
  }

  // ─────────────────────────────────────────
  // USER MANAGEMENT
  // ─────────────────────────────────────────
  async getAllUsers(query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getAllUsers({
      status: query.status,
      role: query.role,
      search: query.search,
      limit,
      offset,
    });
    return { data, pagination: { page, limit, total: count } };
  }

  async getUserDetail(userId) {
    return this.repo.getUserDetail(userId);
  }

  async updateUserStatus(adminId, userId, status, reason) {
    const validStatuses = ['active', 'suspended', 'banned'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Invalid status', 400, 'INVALID_STATUS');
    }

    const result = await this.repo.updateUserStatus(userId, status, adminId, reason);

    // Invalidate user cache
    await this.redis.del(CACHE_KEYS.USER_PROFILE(result.username));

    // Notify user of status change
    if (status !== 'active') {
      await this.notificationService.createNotification({
        userId,
        type: 'admin_message',
        title: status === 'banned' ? 'Account Banned' : 'Account Suspended',
        body: reason || `Your account has been ${status} by our moderation team.`,
        data: { status },
      });
    }

    return result;
  }

  async deleteUser(adminId, userId) {
    await this.repo.hardDeleteUser(userId, adminId);
    return { message: 'User account deleted' };
  }

  // ─────────────────────────────────────────
  // STORE MANAGEMENT
  // ─────────────────────────────────────────
  async getAllStores(query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getAllStores({
      search: query.search,
      isVerified: query.is_verified !== undefined
        ? query.is_verified === 'true'
        : undefined,
      limit,
      offset,
    });
    return { data, pagination: { page, limit, total: count } };
  }

  async setStoreVerification(adminId, storeId, isVerified) {
    const result = await this.repo.setStoreVerification(
      storeId,
      isVerified,
      adminId
    );

    // Invalidate store cache
    await this.redis.del(CACHE_KEYS.STORE(result.slug));

    return result;
  }

  // ─────────────────────────────────────────
  // PRODUCT MANAGEMENT
  // ─────────────────────────────────────────
  async getAllProducts(query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getAllProducts({
      status: query.status,
      search: query.search,
      limit,
      offset,
    });
    return { data, pagination: { page, limit, total: count } };
  }

  async setProductFeatured(adminId, productId, isFeatured, featuredUntil) {
    const result = await this.repo.setProductFeatured(
      productId,
      isFeatured,
      featuredUntil,
      adminId
    );

    await this.redis.del(CACHE_KEYS.PRODUCT(productId));
    await this.redis.del(CACHE_KEYS.TRENDING_FEED);

    return result;
  }

  async deleteProduct(adminId, productId, reason) {
    await this.repo.adminDeleteProduct(productId, adminId, reason);

    await this.redis.del(CACHE_KEYS.PRODUCT(productId));
    await this.redis.del(CACHE_KEYS.TRENDING_FEED);

    return { message: 'Product deleted' };
  }

  // ─────────────────────────────────────────
  // BROADCAST PUSH NOTIFICATION
  // ─────────────────────────────────────────
  async sendBroadcastNotification(adminId, data) {
    const { title, body, user_ids } = data;

    let targetUserIds = user_ids;

    if (!targetUserIds || targetUserIds.length === 0) {
      // Send to all active users
      const { data: allUsers } = await this.supabase
        .from('users')
        .select('id')
        .eq('account_status', 'active')
        .eq('is_deleted', false)
        .not('fcm_token', 'is', null);

      targetUserIds = allUsers?.map((u) => u.id) || [];
    }

    const results = await this.notificationService.sendBroadcastNotification(
      targetUserIds,
      title,
      body,
      { source: 'admin_broadcast' }
    );

    logger.info({ adminId, results }, 'Broadcast notification sent');
    return results;
  }

  // ─────────────────────────────────────────
  // ADMIN LOGS
  // ─────────────────────────────────────────
  async getAdminLogs(query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getAdminLogs({
      adminId: query.admin_id,
      action: query.action,
      limit,
      offset,
    });
    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // SELLER VERIFICATION MANAGEMENT
  // ─────────────────────────────────────────
  async getPendingVerifications(query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.verificationService.repo.getPendingSubmissions({
      status: query.status,
      limit,
      offset,
    });
    return { data, pagination: { page, limit, total: count } };
  }

  async reviewVerification(adminId, submissionId, status, rejectionReason, ipAddress, notes) {
    return this.verificationService.reviewVerification(
      adminId,
      submissionId,
      status,
      rejectionReason,
      ipAddress,
      notes
    );
  }
}

module.exports = AdminService;