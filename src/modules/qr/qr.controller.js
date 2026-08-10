'use strict';

const QRService = require('./qr.service');
const { successResponse } = require('../../shared/utils/responseFormatter');
const ValidationError = require('../../shared/errors/ValidationError');

const {
  generateQRSchema,
  scanQRSchema,
  cancelQRSchema,
  regenerateQRSchema,
} = require('./qr.schema');

class QRController {
  constructor(fastify) {
    this.fastify = fastify;
    this.qrService = new QRService(fastify.supabase, fastify.redis, fastify);
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

  _getDeviceInfo(request) {
    return {
      ipAddress: request.ip,
      deviceFingerprint: request.headers['x-device-id'] || null,
    };
  }

  // POST /qr/generate
  async generateQR(request, reply) {
    const data = this._validate(generateQRSchema, request.body);
    const result = await this.qrService.generateQR(
      request.user.id,
      data,
      this._getDeviceInfo(request)
    );
    return reply.status(201).send(successResponse(result, 'QR code generated successfully'));
  }

  // POST /qr/scan
  async scanQR(request, reply) {
    const data = this._validate(scanQRSchema, request.body);
    const result = await this.qrService.scanQR(
      request.user.id,
      data.token,
      this._getDeviceInfo(request)
    );
    return reply.send(successResponse(result, 'Sale completed successfully'));
  }

  // POST /qr/cancel
  async cancelQR(request, reply) {
    const data = this._validate(cancelQRSchema, request.body);
    const result = await this.qrService.cancelQR(
      request.user.id,
      data.product_id,
      data.reason
    );
    return reply.send(successResponse(result));
  }

  // POST /qr/regenerate
  async regenerateQR(request, reply) {
    const data = this._validate(regenerateQRSchema, request.body);
    const result = await this.qrService.regenerateQR(
      request.user.id,
      data,
      this._getDeviceInfo(request)
    );
    return reply.status(201).send(successResponse(result, 'QR code regenerated successfully'));
  }

  // GET /qr/status/:productId
  async getActiveQRStatus(request, reply) {
    const result = await this.qrService.getActiveQRStatus(
      request.user.id,
      request.params.productId
    );
    return reply.send(successResponse(result));
  }
}

module.exports = QRController;