'use strict';

const ChatService = require('./chat.service');
const { CACHE_KEYS, CACHE_TTL } = require('../../shared/constants/cacheKeys');
const logger = require('../../shared/utils/logger');

class ChatGateway {
  constructor(io, supabase, redis, fastify) {
    this.io = io;
    this.supabase = supabase;
    this.redis = redis;
    this.fastify = fastify;
    this.chatService = new ChatService(supabase, redis);
  }

  // ─────────────────────────────────────────
  // Initialize all socket event handlers
  // ─────────────────────────────────────────
  initialize() {
    // JWT authentication middleware for socket connections
    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth.token ||
          socket.handshake.headers.authorization?.split(' ')[1];

        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT using fastify.jwt
        const decoded = this.fastify.jwt.verify(token);

        // Verify user is active
        const { data: user, error } = await this.supabase
          .from('users')
          .select('id, username, role, account_status, avatar_url')
          .eq('id', decoded.id)
          .eq('account_status', 'active')
          .eq('is_deleted', false)
          .single();

        if (error || !user) {
          return next(new Error('User not found or account inactive'));
        }

        // Attach user to socket
        socket.user = user;
        next();
      } catch (err) {
        logger.warn({ err: err.message }, 'Socket authentication failed');
        next(new Error('Invalid authentication token'));
      }
    });

    // Handle new connections
    this.io.on('connection', (socket) => {
      this._handleConnection(socket);
    });

    logger.info('Chat gateway initialized');
  }

  // ─────────────────────────────────────────
  // Handle individual socket connection
  // ─────────────────────────────────────────
  _handleConnection(socket) {
    const user = socket.user;
    logger.info({ userId: user.id, socketId: socket.id }, 'User connected');

    // Mark user as online in Redis
    this._setUserOnline(user.id, socket.id);

    // Broadcast online status to relevant users
    socket.broadcast.emit('user_online', { userId: user.id });

    // ─── Event Handlers ───

    socket.on('join_conversation', (data) =>
      this._handleJoinConversation(socket, data)
    );

    socket.on('leave_conversation', (data) =>
      this._handleLeaveConversation(socket, data)
    );

    socket.on('send_message', (data) =>
      this._handleSendMessage(socket, data)
    );

    socket.on('typing_start', (data) =>
      this._handleTypingStart(socket, data)
    );

    socket.on('typing_stop', (data) =>
      this._handleTypingStop(socket, data)
    );

    socket.on('mark_read', (data) =>
      this._handleMarkRead(socket, data)
    );

    socket.on('ping_presence', () =>
      this._handlePingPresence(socket)
    );

    socket.on('disconnect', () =>
      this._handleDisconnect(socket)
    );

    socket.on('error', (err) => {
      logger.error({ err, userId: user.id }, 'Socket error');
    });
  }

  // ─────────────────────────────────────────
  // JOIN CONVERSATION ROOM
  // ─────────────────────────────────────────
  async _handleJoinConversation(socket, data) {
    try {
      const { conversationId } = data;

      if (!conversationId) {
        return socket.emit('error', { message: 'conversationId is required' });
      }

      // Verify user is a participant
      const conversation = await this.chatService['repo'].isParticipant(
        conversationId,
        socket.user.id
      );

      if (!conversation) {
        return socket.emit('error', {
          message: 'You are not a participant in this conversation',
        });
      }

      // Join the Socket.io room for this conversation
      await socket.join(`conversation:${conversationId}`);

      // Track active room members in Redis
      await this.redis.client.sadd(
        `conv:members:${conversationId}`,
        socket.user.id
      );

      // Mark messages as read upon joining
      await this.chatService['repo'].markMessagesRead(
        conversationId,
        socket.user.id
      );

      // Notify the room that user is active
      socket.to(`conversation:${conversationId}`).emit('participant_joined', {
        userId:   socket.user.id,
        username: socket.user.username,
      });

      socket.emit('joined_conversation', {
        conversationId,
        message: 'Joined conversation successfully',
      });

      logger.info(
        { userId: socket.user.id, conversationId },
        'User joined conversation room'
      );
    } catch (err) {
      logger.error({ err }, 'handleJoinConversation failed');
      socket.emit('error', { message: 'Failed to join conversation' });
    }
  }

  // ─────────────────────────────────────────
  // LEAVE CONVERSATION ROOM
  // ─────────────────────────────────────────
  async _handleLeaveConversation(socket, data) {
    try {
      const { conversationId } = data;
      await socket.leave(`conversation:${conversationId}`);

      // Remove from active members
      await this.redis.client.srem(
        `conv:members:${conversationId}`,
        socket.user.id
      );

      socket.to(`conversation:${conversationId}`).emit('participant_left', {
        userId: socket.user.id,
      });
    } catch (err) {
      logger.error({ err }, 'handleLeaveConversation failed');
    }
  }

  // ─────────────────────────────────────────
  // SEND MESSAGE
  // ─────────────────────────────────────────
  async _handleSendMessage(socket, data) {
    try {
      const { conversationId, content } = data;

      if (!conversationId || !content?.trim()) {
        return socket.emit('error', {
          message: 'conversationId and content are required',
        });
      }

      if (content.trim().length > 2000) {
        return socket.emit('error', { message: 'Message too long (max 2000 chars)' });
      }

      const message = await this.chatService.sendMessage(
        socket.user.id,
        conversationId,
        content.trim()
      );

      // Emit to all participants in the room (including sender)
      this.io.to(`conversation:${conversationId}`).emit('message_received', {
        message,
        conversationId,
      });

      // Acknowledge to sender
      socket.emit('message_sent', {
        tempId:        data.tempId,
        messageId:     message.id,
        conversationId,
      });

      logger.info(
        { userId: socket.user.id, conversationId, messageId: message.id },
        'Message sent via socket'
      );
    } catch (err) {
      logger.error({ err }, 'handleSendMessage failed');
      socket.emit('message_error', {
        tempId: data?.tempId,
        error:  err.message || 'Failed to send message',
      });
    }
  }

  // ─────────────────────────────────────────
  // TYPING START
  // ─────────────────────────────────────────
  _handleTypingStart(socket, data) {
    const { conversationId } = data;
    if (!conversationId) return;

    const roomName = `conversation:${conversationId}`;
    if (!socket.rooms.has(roomName)) return;

    socket.to(roomName).emit('user_typing', {
      userId:         socket.user.id,
      username:       socket.user.username,
      conversationId,
    });
  }

  // ─────────────────────────────────────────
  // TYPING STOP
  // ─────────────────────────────────────────
  _handleTypingStop(socket, data) {
    const { conversationId } = data;
    if (!conversationId) return;

    const roomName = `conversation:${conversationId}`;
    if (!socket.rooms.has(roomName)) return;

    socket.to(roomName).emit('user_stop_typing', {
      userId:         socket.user.id,
      conversationId,
    });
  }

  // ─────────────────────────────────────────
  // MARK MESSAGES READ
  // ─────────────────────────────────────────
  async _handleMarkRead(socket, data) {
    try {
      const { conversationId } = data;
      if (!conversationId) return;

      await this.chatService['repo'].markMessagesRead(
        conversationId,
        socket.user.id
      );

      socket.to(`conversation:${conversationId}`).emit('messages_read', {
        conversationId,
        readBy: socket.user.id,
        readAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err }, 'handleMarkRead failed');
    }
  }

  // ─────────────────────────────────────────
  // PRESENCE PING
  // ─────────────────────────────────────────
  async _handlePingPresence(socket) {
    await this._setUserOnline(socket.user.id, socket.id);
  }

  // ─────────────────────────────────────────
  // DISCONNECT
  // ─────────────────────────────────────────
  async _handleDisconnect(socket) {
    try {
      logger.info(
        { userId: socket.user.id, socketId: socket.id },
        'User disconnected'
      );

      // Remove online status
      await this.redis.del(CACHE_KEYS.USER_ONLINE(socket.user.id));

      // Broadcast offline status
      socket.broadcast.emit('user_offline', {
        userId: socket.user.id,
      });
    } catch (err) {
      logger.error({ err }, 'handleDisconnect failed');
    }
  }

  // ─────────────────────────────────────────
  // EMIT QR SCAN RESULT to conversation room
  // Called by QR service after successful scan
  // ─────────────────────────────────────────
  emitQRScanned(conversationId, productId, buyerId, sellerId) {
    this.io.to(`conversation:${conversationId}`).emit('qr_scanned', {
      conversationId,
      productId,
      status:    'completed',
      message:   'Sale completed successfully! Please leave a review.',
      timestamp: new Date().toISOString(),
    });
  }

  // ─────────────────────────────────────────
  // ✅ NEW: EMIT QR GENERATED to conversation room
  // Called by QR service after QR is generated
  // Notifies buyer that QR is ready to scan
  // ─────────────────────────────────────────
  emitQRGenerated(conversationId, data) {
    this.io.to(`conversation:${conversationId}`).emit('qr_generated', {
      conversationId,
      productId:  data.productId,
      sellerId:   data.sellerId,
      buyerId:    data.buyerId,
      expiresAt:  data.expiresAt,
      message:    'Seller has generated a QR code. Scan it to complete the purchase.',
      timestamp:  new Date().toISOString(),
    });

    logger.info(
      { conversationId, productId: data.productId },
      'QR generated event emitted to conversation room'
    );
  }

  // ─────────────────────────────────────────
  // PRIVATE: Set user online in Redis
  // ─────────────────────────────────────────
  async _setUserOnline(userId, socketId) {
    await this.redis.set(
      CACHE_KEYS.USER_ONLINE(userId),
      { socketId, timestamp: Date.now() },
      CACHE_TTL.USER_ONLINE
    );
  }
}

module.exports = ChatGateway;