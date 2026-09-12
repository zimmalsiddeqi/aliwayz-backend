'use strict';

const ChatService = require('./chat.service');
const {
  successResponse,
  paginatedResponse,
} = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');
const NotFoundError = require('../../shared/errors/NotFoundError');

const {
  createConversationSchema,
  reportConversationSchema,
} = require('./chat.schema');

class ChatController {
  constructor(fastify) {
    this.fastify = fastify;
    this.chatService = new ChatService(fastify.supabase, fastify.redis);
  }

  _validate(schema, data) {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      throw new ValidationError('Validation failed', errors);
    }
    return result.data;
  }

  // POST /conversations
  async createConversation(request, reply) {
    const data = this._validate(createConversationSchema, request.body);
    const result = await this.chatService.createOrGetConversation(
      request.user.id,
      data
    );
    return reply
      .status(result.is_new ? 201 : 200)
      .send(
        successResponse(
          result.conversation,
          result.is_new ? 'Conversation started' : 'Conversation retrieved'
        )
      );
  }

  // GET /conversations
  async getConversations(request, reply) {
    const result = await this.chatService.getUserConversations(
      request.user.id,
      request.query
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // GET /conversations/:id
  async getConversation(request, reply) {
    // ✅ FIX: Use service method instead of direct repo access
    const conversation = await this.chatService.getConversationById(
      request.user.id,
      request.params.id
    );

    if (!conversation) {
      throw new NotFoundError('Conversation');
    }

    return reply.send(successResponse(conversation));
  }

  // GET /conversations/:id/messages
  async getMessages(request, reply) {
    const result = await this.chatService.getMessages(
      request.user.id,
      request.params.id,
      request.query
    );
    return reply.send(paginatedResponse(result.data, result.pagination));
  }

  // POST /conversations/:id/messages
  async sendMessage(request, reply) {
    const { content } = request.body || {};
    if (!content || !content.trim()) {
      throw new ValidationError('Message content is required');
    }
    const message = await this.chatService.sendMessage(
      request.user.id,
      request.params.id,
      content.trim()
    );
    return reply.status(201).send(successResponse(message, 'Message sent'));
  }

  // DELETE /conversations/:id
  async archiveConversation(request, reply) {
    const result = await this.chatService.archiveConversation(
      request.user.id,
      request.params.id
    );
    return reply.send(successResponse(result));
  }

  // POST /conversations/:id/block
  async blockUser(request, reply) {
    const result = await this.chatService.blockUserInConversation(
      request.user.id,
      request.params.id
    );
    return reply.send(successResponse(result));
  }

  // POST /conversations/:id/report
  async reportConversation(request, reply) {
    const data = this._validate(reportConversationSchema, request.body);
    const result = await this.chatService.reportConversation(
      request.user.id,
      request.params.id,
      data
    );
    return reply.send(successResponse(result));
  }
}

module.exports = ChatController;