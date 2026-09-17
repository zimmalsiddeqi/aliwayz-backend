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

    // 1. Message notification deduplication / consolidation
    if (type === 'new_message' || type === 'chat_message') {
      const convId = payloadData.conversationId || payloadData.conversation_id;
      const senderId = payloadData.senderId || payloadData.sender_id;

      try {
        const existing = await this.repo.findExistingMessageNotification(targetUserId, {
          conversationId: convId,
          senderId,
        });

        if (existing && existing.id) {
          // Update the existing notification to the latest message, reset is_read to false, and bump created_at
          const updated = await this.repo.updateNotification(existing.id, {
            title,
            body,
            data: payloadData,
            is_read: false,
            read_at: null,
            created_at: new Date().toISOString(),
          });

          // Asynchronously clean up any other duplicate rows for this conversation
          if (convId) {
            this.repo
              .cleanupDuplicateMessageNotifications(targetUserId, convId, existing.id)
              .catch(() => {});
          }

          // Send FCM push notification (async — don't block)
          this._sendFCMPush(existing.id, targetUserId, title, body, payloadData, type)
            .catch((err) =>
              logger.warn({ err, userId: targetUserId, type }, 'FCM push failed — non-critical')
            );

          return updated;
        }
      } catch (findErr) {
        logger.warn({ findErr, targetUserId }, 'findExistingMessageNotification non-fatal');
      }
    }

    // 2. Store new in-app notification
    const notification = await this.repo.createNotification({
      user_id: targetUserId,
      type,
      title,
      body,
      data: payloadData,
      is_read: false,
      fcm_sent: false,
    });

    if (!notification || !notification.id) {
      return notification || null;
    }

    // Asynchronously clean up any older duplicates if conversationId is known
    const convId = payloadData.conversationId || payloadData.conversation_id;
    if ((type === 'new_message' || type === 'chat_message') && convId) {
      this.repo
        .cleanupDuplicateMessageNotifications(targetUserId, convId, notification.id)
        .catch(() => {});
    }

    // 3. Send FCM push notification (async — don't block)
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
  // DELETE SINGLE NOTIFICATION
  // ─────────────────────────────────────────
  async deleteNotification(userId, notificationId) {
    const deleted = await this.repo.deleteNotification(userId, notificationId);
    const unreadCount = await this.repo.getUnreadCount(userId);
    return {
      message: 'Notification deleted',
      deleted_id: notificationId,
      unread_count: unreadCount,
    };
  }

  // ─────────────────────────────────────────
  // DELETE ALL NOTIFICATIONS
  // ─────────────────────────────────────────
  async deleteAllNotifications(userId) {
    await this.repo.deleteAllNotifications(userId);
    return {
      message: 'All notifications deleted',
      unread_count: 0,
    };
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
    const tokens = await this.repo.getUserPushTokens(userId);
    if (!tokens || tokens.length === 0) return; // User has no registered push tokens

    const payloadData = data && typeof data === 'object' ? data : {};

    // Map notification type to frontend deep-link route
    let targetRoute = '/notifications';
    if (payloadData.route) {
      targetRoute = payloadData.route;
    } else {
      const convId = payloadData.conversation_id || payloadData.conversationId;
      const prodId = payloadData.product_id || payloadData.productId;
      const storeSlug = payloadData.seller_store_slug || payloadData.store_slug || payloadData.storeSlug || payloadData.follower_username;

      switch (type) {
        case 'new_message':
        case 'chat_message':
        case 'buyer_message':
          targetRoute = convId ? `/inbox/${convId}` : '/inbox';
          break;
        case 'product_sold':
        case 'order_completed':
          targetRoute = storeSlug ? `/store/${storeSlug}` : '/notifications';
          break;
        case 'new_follower':
          targetRoute = storeSlug ? `/store/${storeSlug}` : '/notifications';
          break;
        case 'price_update':
        case 'review_received':
        case 'product_matched':
        case 'wanted_match':
          targetRoute = prodId ? `/product/${prodId}` : '/notifications';
          break;
        case 'qr_generated':
        case 'qr_scanned':
        case 'sale_completed':
          targetRoute = convId ? `/inbox/${convId}` : '/inbox';
          break;
        case 'badge_earned':
          targetRoute = '/profile';
          break;
        case 'verification_approved':
        case 'verification_rejected':
          targetRoute = '/verification';
          break;
        case 'report_resolved':
        case 'admin_message':
        default:
          targetRoute = '/notifications';
          break;
      }
    }

    const stringData = {
      type: type || 'general',
      notification_id: String(notificationId),
      route: targetRoute,
      title: title || 'Aliwayz',
      body: body || '',
      channel_id: 'aliwayz_default',
      ...Object.fromEntries(
        Object.entries(payloadData).map(([k, v]) => [k, String(v ?? '')])
      ),
    };

    // DATA-ONLY message: ensures onMessageReceived() fires in ALL app states
    // (foreground, background, killed) for WhatsApp-style notification control.
    // Do NOT add a top-level 'notification' block — it causes Android OS to
    // intercept and display its own notification in background/killed state,
    // bypassing our custom sound, vibration, deep-link routing, and styling.
    const multicastMessage = {
      tokens,
      data: stringData,
      android: {
        priority: 'high',
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            'content-available': 1,
            sound: 'default',
            badge: 1,
            alert: {
              title: title || 'Aliwayz',
              body: body || '',
            },
          },
        },
      },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(multicastMessage);
      logger.info(
        { userId, type, notificationId, successCount: response.successCount, failureCount: response.failureCount },
        'FCM multicast batch sent'
      );

      if (response.successCount > 0) {
        await this.repo.markFCMSent(notificationId);
      }

      // Handle failed tokens (uninstalled app, expired token)
      if (response.failureCount > 0) {
        for (let i = 0; i < response.responses.length; i++) {
          const resp = response.responses[i];
          if (!resp.success && resp.error) {
            const errCode = resp.error.code;
            if (
              errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered'
            ) {
              const deadToken = tokens[i];
              logger.warn({ userId, deadToken: deadToken.substring(0, 10) + '...' }, 'Deactivating dead FCM token');
              await this.repo.deactivateInvalidToken(deadToken);
            }
          }
        }
      }
    } catch (err) {
      logger.error({ err: err.message, userId, notificationId }, 'FCM sendEachForMulticast error');
      throw err;
    }
  }
}

module.exports = NotificationService;