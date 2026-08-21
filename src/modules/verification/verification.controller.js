'use strict';

const VerificationService = require('./verification.service');
const { successResponse } = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');
const { submitVerificationSchema } = require('./verification.schema');

class VerificationController {
  constructor(fastify) {
    this.fastify = fastify;
    this.verificationService = new VerificationService(fastify.supabase, fastify.redis);
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

  /**
   * GET /verification/status
   */
  async getStatus(request, reply) {
    const statusInfo = await this.verificationService.getVerificationStatus(request.user.id);
    return reply.send(successResponse(statusInfo));
  }

  /**
   * POST /verification/submit
   */
  async submitVerification(request, reply) {
    const parts = request.parts();
    const fields = {};
    const files = {};

    try {
      for await (const part of parts) {
        if (part.file) {
          const chunks = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          if (chunks.length > 0) {
            files[part.fieldname] = {
              buffer: Buffer.concat(chunks),
              mimetype: part.mimetype,
              filename: part.filename,
            };
          }
        } else {
          fields[part.fieldname] = part.value;
        }
      }
    } catch (err) {
      this.fastify.log.error({ err }, 'Failed to parse verification multipart input');
      throw new ValidationError('Failed to parse upload request');
    }

    // Validate body data
    const validatedData = this._validate(submitVerificationSchema, fields);

    const result = await this.verificationService.submitVerification(
      request.user.id,
      validatedData,
      files
    );

    return reply
      .status(201)
      .send(successResponse(result, 'Seller identity verification submitted successfully'));
  }
}

module.exports = VerificationController;
