'use strict';

module.exports = {
  // Product image limits
  MAX_PRODUCT_IMAGES: 20,
  MAX_IMAGE_SIZE_MB: 10,
  MAX_VIDEO_SIZE_MB: 100,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/quicktime'],

  // Auto-cleanup timing
  SOLD_PRODUCT_CLEANUP_HOURS: 24,

  // Pagination defaults
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 50,

  // Search
  MAX_SEARCH_RESULTS: 100,
  SEARCH_HISTORY_LIMIT: 10,

  // Notification types
  NOTIFICATION_TYPES: {
    NEW_MESSAGE: 'new_message',
    NEW_FOLLOWER: 'new_follower',
    PRICE_UPDATE: 'price_update',
    PRODUCT_SOLD: 'product_sold',
    REVIEW_RECEIVED: 'review_received',
    ADMIN_MESSAGE: 'admin_message',
    QR_GENERATED: 'qr_generated',
    BADGE_EARNED: 'badge_earned',
    REPORT_RESOLVED: 'report_resolved',
  },

  // Account status
  ACCOUNT_STATUS: {
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    BANNED: 'banned',
    PENDING: 'pending',
  },
};