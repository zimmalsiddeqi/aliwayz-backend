'use strict';

const admin = require('firebase-admin');
const NotificationRepository = require('./notification.repository');
const { getPaginationParams } = require('../../shared/utils/paginate');
const logger = require('../../shared/utils/logger');

// Initialize Firebase Admin SDK (singleton)
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) return;

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    firebaseInitialized = true;
    logger.info('Firebase Admin SDK initialized');
  } catch (err) {
    logger.error({ err }, 'Firebase Admin SDK initialization failed');
  }
}

class NotificationService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new NotificationRepository(supabase);
    initializeFirebase();
  }

  // ─────────────────────────────────────────
  // CREATE IN-APP NOTIFICATION + SEND FCM PUSH
  // ─────────────────────────────────────────
  async createNotification({ userId, user_id, type, title, body, data = {} }) {
    const targetUserId = userId || user_id;
    const payloadData = data && typeof data === 'object' ? data : {};

    // 1. Store in-app notification
    const notification = await this.repo.createNotification({
      user_id: targetUserId,
      type,
      title,
      body,
      data: payloadData,
      is_read: false,
      fcm_sent: false,
    });

    // 2. Send FCM push notification (async — don't block)
    this._sendFCMPush(notification.id, targetUserId, title, body, payloadData, type)
      .catch((err) =>
        logger.warn({ err, userId: targetUserId, type }, 'FCM push failed — non-critical')
      );

    return notification;
  }

  // ─────────────────────────────────────────
  // GET USER NOTIFICATIONS
  // ─────────────────────────────────────────
  async getUserNotifications(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getUserNotifications(userId, {
      limit,
      offset,
    });

    const unreadCount = await this.repo.getUnreadCount(userId);

    return {
      data,
      pagination: { page, limit, total: count },
      unread_count: unreadCount,
    };
  }

  // ─────────────────────────────────────────
  // MARK SINGLE NOTIFICATION READ
  // ─────────────────────────────────────────
  async markAsRead(userId, notificationId) {
    await this.repo.markAsRead(userId, notificationId);
    return { message: 'Notification marked as read' };
  }

  // ─────────────────────────────────────────
  // MARK ALL NOTIFICATIONS READ
  // ─────────────────────────────────────────
  async markAllAsRead(userId) {
    await this.repo.markAllAsRead(userId);
    return { message: 'All notifications marked as read' };
  }

  // ─────────────────────────────────────────
  // SEND BROADCAST PUSH (Admin function)
  // Sends to a list of user IDs or all users
  // ─────────────────────────────────────────
  async sendBroadcastNotification(userIds, title, body, data = {}) {
    const results = { success: 0, failed: 0 };

    // Process in batches of 500 (FCM limit)
    const batchSize = 500;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (userId) => {
          try {
            await this.createNotification({
              userId,
              type: 'admin_message',
              title,
              body,
              data,
            });
            results.success++;
          } catch {
            results.failed++;
          }
        })
      );
    }

    return results;
  }

  // ─────────────────────────────────────────
  // PRIVATE: Send FCM push notification
  // ─────────────────────────────────────────
  async _sendFCMPush(notificationId, userId, title, body, data, type) {
    const fcmToken = await this.repo.getUserFCMToken(userId);
    if (!fcmToken) return; // User has no push token (web user or not registered)

    const payloadData = data && typeof data === 'object' ? data : {};

    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: {
        type: type || 'general',
        notification_id: String(notificationId),
        // FCM data must be strings
        ...Object.fromEntries(
          Object.entries(payloadData).map(([k, v]) => [k, String(v ?? '')])
        ),
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    try {
      await admin.messaging().send(message);
      await this.repo.markFCMSent(notificationId);

      logger.info(
        { userId, type, notificationId },
        'FCM push notification sent'
      );
    } catch (err) {
      // Handle invalid FCM token (user uninstalled app)
      if (
        err.code === 'messaging/invalid-registration-token' ||
        err.code === 'messaging/registration-token-not-registered'
      ) {
        logger.warn(
          { userId },
          'Invalid FCM token — clearing from user record'
        );
        // Clear invalid token
        await this.supabase
          .from('users')
          .update({ fcm_token: null })
          .eq('id', userId);
      } else {
        throw err;
      }
    }
  }
}

module.exports = NotificationService;