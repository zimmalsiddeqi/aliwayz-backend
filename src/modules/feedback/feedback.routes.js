'use strict';

const { authenticate } = require('../../middleware/authenticate');
const { requireAdmin } = require('../../middleware/authorize');
const { sanitizeInput } = require('../../middleware/sanitize');
const logger = require('../../shared/utils/logger');
const { successResponse, paginatedResponse } = require('../../shared/utils/responseFormatter');

async function feedbackRoutes(fastify) {
  const supabase = fastify.supabase;

  // POST /feedback — anyone can submit
  fastify.post('/', {
    config: { rateLimit: { max: 5, timeWindow: '15m' } },
    preHandler: [sanitizeInput],
    handler: async (request, reply) => {
      const { name, email, type, rating, message } = request.body;

      if (!message || message.trim().length < 5) {
        return reply.status(400).send({
          success: false,
          message: 'Message must be at least 5 characters',
        });
      }

      const userId = request.user?.id || null;

      const { data, error } = await supabase
        .from('site_feedback')
        .insert({
          user_id: userId,
          name:    name || null,
          email:   email || null,
          type:    type || 'feedback',
          rating:  rating || null,
          message: message.trim(),
          status:  'unread',
        })
        .select('id, type, rating, message, created_at')
        .single();

      if (error) {
        logger.error({ error }, 'Failed to submit feedback');
        return reply.status(500).send({
          success: false,
          message: 'Failed to submit feedback',
        });
      }

      logger.info({ feedbackId: data.id, type }, 'Site feedback submitted');

      return reply.status(201).send(
        successResponse(data, 'Feedback submitted! Thank you.')
      );
    },
  });

  // GET /feedback — admin only
  fastify.get('/', {
    preHandler: [authenticate, requireAdmin],
    handler: async (request, reply) => {
      const {
        page   = 1,
        limit  = 20,
        status,
        type,
      } = request.query;

      const offset = (page - 1) * limit;

      let query = supabase
        .from('site_feedback')
        .select(
          `id, user_id, name, email, type, rating, message, status,
           admin_reply, replied_at, created_at, updated_at,
           users:user_id (id, username, avatar_url)`,
          { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (type)   query = query.eq('type', type);

      const { data, error, count } = await query;

      if (error) {
        logger.error({ error }, 'Failed to fetch feedback');
        return reply.status(500).send({
          success: false,
          message: 'Failed to fetch feedback',
        });
      }

      return reply.send(
        paginatedResponse(data || [], {
          page:        Number(page),
          limit:       Number(limit),
          total:       count || 0,
          total_pages: Math.ceil((count || 0) / limit),
          has_next:    page * limit < (count || 0),
          has_prev:    page > 1,
        })
      );
    },
  });

  // PUT /feedback/:id — admin mark as read/reply
  fastify.put('/:id', {
    preHandler: [authenticate, requireAdmin, sanitizeInput],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { status, admin_reply } = request.body;

      const updates = { updated_at: new Date().toISOString() };
      if (status)      updates.status      = status;
      if (admin_reply) {
        updates.admin_reply = admin_reply;
        updates.replied_at  = new Date().toISOString();
        updates.replied_by  = request.user.id;
        updates.status      = 'responded';
      }

      const { data, error } = await supabase
        .from('site_feedback')
        .update(updates)
        .eq('id', id)
        .select('id, status, admin_reply, replied_at')
        .single();

      if (error) {
        return reply.status(500).send({
          success: false,
          message: 'Failed to update feedback',
        });
      }

      return reply.send(
        successResponse(data, 'Feedback updated')
      );
    },
  });

  // DELETE /feedback/:id — admin delete
  fastify.delete('/:id', {
    preHandler: [authenticate, requireAdmin],
    handler: async (request, reply) => {
      const { error } = await supabase
        .from('site_feedback')
        .delete()
        .eq('id', request.params.id);

      if (error) {
        return reply.status(500).send({
          success: false,
          message: 'Failed to delete feedback',
        });
      }

      return reply.send(
        successResponse(null, 'Feedback deleted')
      );
    },
  });
}

module.exports = feedbackRoutes;