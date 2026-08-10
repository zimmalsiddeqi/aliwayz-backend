'use strict';

const ChatRepository = require('./chat.repository');
const NotificationService = require('../notifications/notification.service');
const { containsProfanity } = require('../../shared/utils/profanityFilter');
const { getPaginationParams } = require('../../shared/utils/paginate');
const { CACHE_KEYS } = require('../../shared/constants/cacheKeys');
const constants = require('../../config/constants');
const logger = require('../../shared/utils/logger');

const AppError = require('../../shared/errors/AppError');
const NotFoundError = require('../../shared/errors/NotFoundError');
const ForbiddenError = require('../../shared/errors/ForbiddenError');

class ChatService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new ChatRepository(supabase);
    this.notificationService = new NotificationService(supabase, redis);
  }

  // ─────────────────────────────────────────
  // CREATE OR GET CONVERSATION
  // One conversation per product per buyer
  // ─────────────────────────────────────────
  async createOrGetConversation(buyerId, data) {
    const { product_id, initial_message } = data;

    // Get product and seller info
    const { data: product, error: productError } = await this.supabase
      .from('products')
      .select('id, seller_id, status, title, is_deleted')
      .eq('id', product_id)
      .single();

    if (productError || !product) throw new NotFoundError('Product');

    if (product.is_deleted) {
      throw new AppError('This product is no longer available', 400);
    }

    if (product.status === 'sold') {
      throw new AppError('This product has already been sold', 400);
    }

    // Cannot message yourself
    if (product.seller_id === buyerId) {
      throw new AppError('You cannot send messages about your own product', 400);
    }

    // Check for existing conversation
    let conversation = await this.repo.findConversation(product_id, buyerId);

    if (conversation) {
      // Reactivate if archived
      if (conversation.status === 'archived') {
        await this.repo.updateConversationStatus(conversation.id, 'active');
        conversation.status = 'active';
      }
      return { conversation, is_new: false };
    }

    // Create new conversation
conversation = await this.repo.createConversation({
  product_id,
  buyer_id:  buyerId,
  seller_id: product.seller_id,
  status:    'active',
});

// ✅ FIX: Only send message if provided — NO fallback/default
if (initial_message && initial_message.trim()) {
  await this._sendMessage(
    conversation.id,
    buyerId,
    conversation.buyer_id,
    initial_message.trim()
  );
}

    // Notify seller
    await this.notificationService.createNotification({
      userId: product.seller_id,
      type: constants.NOTIFICATION_TYPES.NEW_MESSAGE,
      title: 'New Message',
      body: `Someone is interested in your ${product.title}`,
      data: {
        conversationId: conversation.id,
        productId: product_id,
      },
    });

    logger.info(
      { buyerId, sellerId: product.seller_id, conversationId: conversation.id },
      'Conversation created'
    );

    return { conversation, is_new: true };
  }

  // ─────────────────────────────────────────
  // GET ALL CONVERSATIONS (Inbox)
  // ─────────────────────────────────────────
  async getUserConversations(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getUserConversations(userId, {
      limit,
      offset,
    });

    // Attach is_online status from Redis
    const enrichedData = await Promise.all(
      data.map(async (conv) => {
        const otherParty =
          conv.buyer?.id === userId ? conv.seller : conv.buyer;

        if (otherParty?.id) {
          const isOnline = await this.redis.exists(
            CACHE_KEYS.USER_ONLINE(otherParty.id)
          );
          return {
            ...conv,
            other_party_online: isOnline,
            unread_count:
              conv.buyer_id === userId
                ? conv.buyer_unread_count
                : conv.seller_unread_count,
          };
        }

        return conv;
      })
    );

    return { data: enrichedData, pagination: { page, limit, total: count } };
  }
    // ─────────────────────────────────────────
  // GET SINGLE CONVERSATION BY ID
  // ✅ NEW: Replaces direct repo access in controller
  // ─────────────────────────────────────────
  async getConversationById(userId, conversationId) {
    // Verify participant first
    const participant = await this.repo.isParticipant(conversationId, userId);
    if (!participant) {
      const ForbiddenError = require('../../shared/errors/ForbiddenError');
      throw new ForbiddenError(
        'You are not a participant in this conversation'
      );
    }

    return this.repo.findConversationById(conversationId);
  }

  // ─────────────────────────────────────────
  // GET MESSAGES (History)
  // ─────────────────────────────────────────
  async getMessages(userId, conversationId, query) {
    // Verify participant
    const conversation = await this.repo.isParticipant(conversationId, userId);
    if (!conversation) {
      throw new ForbiddenError('You are not a participant in this conversation');
    }

    if (conversation.status === 'blocked') {
      throw new AppError(
        'This conversation has been blocked',
        403,
        'CONVERSATION_BLOCKED'
      );
    }

    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getMessages(conversationId, {
      limit,
      offset,
    });

    // Mark messages as read (async — don't block response)
    this.repo
      .markMessagesRead(conversationId, userId)
      .catch((err) => logger.warn({ err }, 'markMessagesRead failed'));

    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // SEND MESSAGE (Used by Socket.io gateway)
  // ─────────────────────────────────────────
  async sendMessage(senderId, conversationId, content) {
    // Verify participant
    const conversation = await this.repo.isParticipant(conversationId, senderId);
    if (!conversation) {
      throw new ForbiddenError('You are not a participant in this conversation');
    }

    if (conversation.status === 'blocked') {
      throw new AppError('This conversation has been blocked', 403);
    }

    if (conversation.status === 'completed') {
      throw new AppError(
        'This conversation has been completed. Sale was finalized.',
        400
      );
    }

    // Profanity filter
    if (containsProfanity(content)) {
      throw new AppError(
        'Message contains prohibited content',
        400,
        'PROFANITY_DETECTED'
      );
    }

    const message = await this._sendMessage(
      conversationId,
      senderId,
      conversation.buyer_id,
      content
    );

    // Send push notification to offline user
    const recipientId =
      senderId === conversation.buyer_id
        ? conversation.seller_id
        : conversation.buyer_id;

    const isOnline = await this.redis.exists(CACHE_KEYS.USER_ONLINE(recipientId));

    if (!isOnline) {
      // Get sender info for notification
      const { data: sender } = await this.supabase
        .from('users')
        .select('username')
        .eq('id', senderId)
        .single();

      await this.notificationService.createNotification({
        userId: recipientId,
        type: constants.NOTIFICATION_TYPES.NEW_MESSAGE,
        title: `New message from ${sender?.username || 'Someone'}`,
        body: content.length > 50 ? `${content.substring(0, 50)}...` : content,
        data: { conversationId },
      });
    }

    return message;
  }

  // ─────────────────────────────────────────
  // ARCHIVE CONVERSATION
  // ─────────────────────────────────────────
  async archiveConversation(userId, conversationId) {
    const conversation = await this.repo.isParticipant(conversationId, userId);
    if (!conversation) {
      throw new ForbiddenError('You are not a participant in this conversation');
    }

    await this.repo.updateConversationStatus(conversationId, 'archived');
    return { message: 'Conversation archived' };
  }

  // ─────────────────────────────────────────
  // BLOCK USER IN CONVERSATION
  // ─────────────────────────────────────────
  async blockUserInConversation(userId, conversationId) {
    const conversation = await this.repo.isParticipant(conversationId, userId);
    if (!conversation) {
      throw new ForbiddenError('You are not a participant in this conversation');
    }

    await this.repo.updateConversationStatus(conversationId, 'blocked');

    logger.info(
      { userId, conversationId },
      'User blocked in conversation'
    );

    return { message: 'User blocked successfully' };
  }

  // ─────────────────────────────────────────
  // REPORT CONVERSATION
  // ─────────────────────────────────────────
  async reportConversation(reporterId, conversationId, data) {
    const conversation = await this.repo.isParticipant(conversationId, reporterId);
    if (!conversation) {
      throw new ForbiddenError('You are not a participant in this conversation');
    }

    const targetId =
      reporterId === conversation.buyer_id
        ? conversation.seller_id
        : conversation.buyer_id;

    await this.supabase.from('reports').insert({
      reporter_id: reporterId,
      target_type: 'user',
      target_id: targetId,
      reason: data.reason,
      description: data.description || null,
    });

    return { message: 'Report submitted successfully' };
  }

  // ─────────────────────────────────────────
  // PRIVATE: Core send message logic
  // ─────────────────────────────────────────
  async _sendMessage(conversationId, senderId, buyerId, content) {
    const message = await this.repo.createMessage({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      content_type: 'text',
    });

    // Update conversation preview
    const preview =
      content.length > 100 ? `${content.substring(0, 100)}...` : content;

    await this.repo.updateConversationLastMessage(
      conversationId,
      preview,
      senderId,
      buyerId
    );

    return message;
  }

  // ─────────────────────────────────────────
  // VERIFY CONVERSATION FOR QR
  // Called by QR service to validate buyer-seller pair
  // ─────────────────────────────────────────
  async verifyConversationForQR(productId, buyerId, sellerId) {
    const conversation = await this.repo.findConversation(productId, buyerId);

    if (!conversation) return null;
    if (conversation.seller_id !== sellerId) return null;
    if (conversation.status === 'blocked') return null;

    return conversation;
  }
}

module.exports = ChatService;