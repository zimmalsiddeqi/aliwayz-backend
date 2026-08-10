'use strict';

const logger = require('../../shared/utils/logger');

class NotificationRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Create notification record
  // ─────────────────────────────────────────
  async createNotification(notificationData) {
    const { data, error } = await this.supabase
      .from('notifications')
      .insert(notificationData)
      .select('id, type, title, body, data, is_read, created_at')
      .single();

    if (error) {
      logger.error({ error }, 'createNotification failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Get user notifications (paginated)
  // ─────────────────────────────────────────
  async getUserNotifications(userId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('notifications')
      .select(
        'id, type, title, body, data, is_read, read_at, fcm_sent, created_at',
        { count: 'exact' }
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getUserNotifications failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get unread notification count
  // ─────────────────────────────────────────
  async getUnreadCount(userId) {
    const { count, error } = await this.supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      logger.error({ error }, 'getUnreadCount failed');
      return 0;
    }

    return count || 0;
  }

  // ─────────────────────────────────────────
  // Mark single notification as read
  // ─────────────────────────────────────────
  async markAsRead(userId, notificationId) {
    // Include read_at timestamp in update to satisfy the set_updated_at trigger
    // (notifications table trigger expects updated_at but it was added in migration 009)
    const { error } = await this.supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select('id');  // PostgREST: using select to avoid trigger issue in older schemas

    if (error && error.code !== '42703') {
      // 42703 = column does not exist (updated_at missing) — non-fatal, the read was still set
      logger.error({ error }, 'markAsRead failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Mark all notifications as read
  // ─────────────────────────────────────────
  async markAllAsRead(userId) {
    const { error } = await this.supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('is_read', false)
      .select('id');  // select forces PostgREST to use RETURNING which avoids trigger re-execution

    if (error && error.code !== '42703') {
      // 42703 = column 'updated_at' does not exist — non-fatal
      logger.error({ error }, 'markAllAsRead failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Mark notification as FCM sent
  // ─────────────────────────────────────────
  async markFCMSent(notificationId) {
    const { error } = await this.supabase
      .from('notifications')
      .update({
        fcm_sent: true,
        fcm_sent_at: new Date().toISOString(),
      })
      .eq('id', notificationId);

    if (error) {
      logger.warn({ error }, 'markFCMSent failed');
    }
  }

  // ─────────────────────────────────────────
  // Get FCM token for a user
  // ─────────────────────────────────────────
  async getUserFCMToken(userId) {
    const { data, error } = await this.supabase
      .from('users')
      .select('fcm_token')
      .eq('id', userId)
      .single();

    if (error) return null;
    return data?.fcm_token || null;
  }

  // ─────────────────────────────────────────
  // Delete old notifications (cleanup)
  // ─────────────────────────────────────────
  async deleteOldNotifications(daysOld = 30) {
    const cutoffDate = new Date(
      Date.now() - daysOld * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error } = await this.supabase
      .from('notifications')
      .delete()
      .eq('is_read', true)
      .lt('created_at', cutoffDate);

    if (error) {
      logger.error({ error }, 'deleteOldNotifications failed');
      throw error;
    }
  }
}

module.exports = NotificationRepository;