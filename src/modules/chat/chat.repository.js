'use strict';

const logger = require('../../shared/utils/logger');

class ChatRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Find conversation by product + buyer pair
  // Enforces one conversation per product per buyer
  // ─────────────────────────────────────────
  async findConversation(productId, buyerId) {
    const { data, error } = await this.supabase
      .from('conversations')
      .select(`
        id,
        product_id,
        buyer_id,
        seller_id,
        status,
        last_message_at,
        last_message_preview,
        buyer_unread_count,
        seller_unread_count,
        created_at,
        products (
          id,
          title,
          slug,
          price,
          currency,
          status,
          product_images (
            cdn_url,
            is_primary
          )
        ),
        buyer:buyer_id (
          id,
          username,
          avatar_url
        ),
        seller:seller_id (
          id,
          username,
          avatar_url
        )
      `)
      .eq('product_id', productId)
      .eq('buyer_id', buyerId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findConversation failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Find conversation by ID
  // ─────────────────────────────────────────
  async findConversationById(conversationId) {
    const { data, error } = await this.supabase
      .from('conversations')
      .select(`
        id,
        product_id,
        buyer_id,
        seller_id,
        status,
        last_message_at,
        last_message_preview,
        buyer_unread_count,
        seller_unread_count,
        created_at,
        products (
          id,
          title,
          slug,
          price,
          currency,
          status,
          product_images (
            cdn_url,
            is_primary
          )
        ),
        buyer:buyer_id (
          id,
          username,
          avatar_url
        ),
        seller:seller_id (
          id,
          username,
          avatar_url
        ),
        qr_transactions (
          id,
          status
        )
      `)
      .eq('id', conversationId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findConversationById failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Create new conversation
  // ─────────────────────────────────────────
  async createConversation(conversationData) {
    const { data, error } = await this.supabase
      .from('conversations')
      .insert(conversationData)
      .select(`
        id,
        product_id,
        buyer_id,
        seller_id,
        status,
        created_at,
        products (
          id,
          title,
          slug,
          price,
          product_images (
            cdn_url,
            is_primary
          )
        ),
        seller:seller_id (
          id,
          username,
          avatar_url
        )
      `)
      .single();

    if (error) {
      logger.error({ error }, 'createConversation failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Get all conversations for a user (inbox)
  // ─────────────────────────────────────────
  async getUserConversations(userId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('conversations')
      .select(
        `
        id,
        status,
        last_message_at,
        last_message_preview,
        buyer_unread_count,
        seller_unread_count,
        created_at,
        products (
          id,
          title,
          slug,
          price,
          currency,
          status,
          product_images (
            cdn_url,
            is_primary
          )
        ),
        buyer:buyer_id (
          id,
          username,
          avatar_url
        ),
        seller:seller_id (
          id,
          username,
          avatar_url
        )
      `,
        { count: 'exact' }
      )
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .neq('status', 'archived')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getUserConversations failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get messages for a conversation (paginated)
  // Loads older messages as user scrolls up
  // ─────────────────────────────────────────
  async getMessages(conversationId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('messages')
      .select(
        `
        id,
        conversation_id,
        sender_id,
        content,
        content_type,
        is_read,
        read_at,
        is_deleted,
        created_at,
        sender:sender_id (
          id,
          username,
          avatar_url
        )
      `,
        { count: 'exact' }
      )
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false }) // Newest first (reverse scroll)
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getMessages failed');
      throw error;
    }

    return { data: (data || []).reverse(), count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Create message
  // ─────────────────────────────────────────
  async createMessage(messageData) {
    const { data, error } = await this.supabase
      .from('messages')
      .insert(messageData)
      .select(`
        id,
        conversation_id,
        sender_id,
        content,
        content_type,
        is_read,
        created_at,
        sender:sender_id (
          id,
          username,
          avatar_url
        )
      `)
      .single();

    if (error) {
      logger.error({ error }, 'createMessage failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Update conversation metadata after new message
  // ─────────────────────────────────────────
  async updateConversationLastMessage(
    conversationId,
    preview,
    senderId,
    buyerId
  ) {
    const isBuyer = senderId === buyerId;

    const updateData = {
      last_message_at: new Date().toISOString(),
      last_message_preview: preview,
      updated_at: new Date().toISOString(),
    };

    // Increment unread count for the OTHER party
    if (isBuyer) {
      updateData.seller_unread_count = this.supabase.rpc
        ? undefined
        : undefined; // handled via RPC below
    }

    const { error } = await this.supabase
      .from('conversations')
      .update(updateData)
      .eq('id', conversationId);

    if (error) {
      logger.error({ error }, 'updateConversationLastMessage failed');
      throw error;
    }

    // Increment unread count atomically
    await this.supabase.rpc('increment_unread_count', {
      p_conversation_id: conversationId,
      p_is_buyer_sender: isBuyer,
    });
  }

  // ─────────────────────────────────────────
  // Mark messages as read
  // ─────────────────────────────────────────
  async markMessagesRead(conversationId, readerId) {
    const now = new Date().toISOString();

    const { error } = await this.supabase
      .from('messages')
      .update({ is_read: true, read_at: now })
      .eq('conversation_id', conversationId)
      .neq('sender_id', readerId)
      .eq('is_read', false);

    if (error) {
      logger.error({ error }, 'markMessagesRead failed');
      throw error;
    }

    // Reset unread count for the reader
    await this.supabase.rpc('reset_unread_count', {
      p_conversation_id: conversationId,
      p_user_id: readerId,
    });
  }

  // ─────────────────────────────────────────
  // Update conversation status
  // ─────────────────────────────────────────
  async updateConversationStatus(conversationId, status) {
    const { error } = await this.supabase
      .from('conversations')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error }, 'updateConversationStatus failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Check if user is participant in conversation
  // ─────────────────────────────────────────
  async isParticipant(conversationId, userId) {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('id, buyer_id, seller_id, status')
      .eq('id', conversationId)
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  // ─────────────────────────────────────────
  // Soft delete a message
  // ─────────────────────────────────────────
  async deleteMessage(messageId, senderId) {
    const { error } = await this.supabase
      .from('messages')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        content: '[Message deleted]',
      })
      .eq('id', messageId)
      .eq('sender_id', senderId);

    if (error) {
      logger.error({ error }, 'deleteMessage failed');
      throw error;
    }
  }
}

module.exports = ChatRepository;