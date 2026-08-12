'use strict';

const dayjs = require('dayjs');
const QRCode = require('qrcode');
const crypto = require('crypto');

const QRRepository = require('./qr.repository');
const ChatService = require('../chat/chat.service');
const BadgeEngine = require('../badges/badge.engine');
const NotificationService = require('../notifications/notification.service');

const qrCrypto = require('./qr.crypto');
const appConfig = require('../../config/app.config');
const logger = require('../../shared/utils/logger');
const constants = require('../../config/constants');

const { CACHE_KEYS } = require('../../shared/constants/cacheKeys');
const { PRODUCT_STATUS } = require('../../shared/constants/productStatus');

const AppError = require('../../shared/errors/AppError');
const NotFoundError = require('../../shared/errors/NotFoundError');
const ForbiddenError = require('../../shared/errors/ForbiddenError');

class QRService {
  constructor(supabase, redis, fastify) {
    this.supabase = supabase;
    this.redis = redis;
    this.fastify = fastify;
    this.repo = new QRRepository(supabase);
    this.chatService = new ChatService(supabase, redis);
    this.badgeEngine = new BadgeEngine(supabase, redis);
    this.notificationService = new NotificationService(supabase, redis);
  }

  // ─────────────────────────────────────────
  // GENERATE QR CODE
  // Only seller can generate, only after active conversation
  // ─────────────────────────────────────────
  async generateQR(sellerId, data, deviceInfo = {}) {
    const { product_id, buyer_id } = data;

    // Verify product belongs to seller and is available/reserved
    const { data: product, error: productError } = await this.supabase
      .from('products')
      .select('id, seller_id, status, title, price, currency, is_deleted')
      .eq('id', product_id)
      .single();

    if (productError || !product) throw new NotFoundError('Product');

    if (product.seller_id !== sellerId) {
      throw new ForbiddenError('You do not own this product');
    }

    if (product.is_deleted) {
      throw new AppError('Product is no longer available', 400);
    }

    if (!['available', 'reserved'].includes(product.status)) {
      throw new AppError(
        `Cannot generate QR for a product with status: ${product.status}`,
        400,
        'INVALID_PRODUCT_STATUS'
      );
    }

    // Verify active conversation exists between this buyer and seller
    const conversation = await this.chatService.verifyConversationForQR(
      product_id,
      buyer_id,
      sellerId
    );

    if (!conversation) {
      throw new AppError(
        'No active conversation found with this buyer for this product. ' +
        'The buyer must message you first before completing a sale.',
        400,
        'NO_ACTIVE_CONVERSATION'
      );
    }

    // Cancel any existing pending QR for this product (prevent duplicates)
    await this.repo.cancelAllPendingQRsForProduct(
      product_id,
      'replaced_by_new_generation'
    );

    // Remove old QR tokens from Redis
    const oldRedisPattern = `qr:active:product:${product_id}`;
    await this.redis.del(oldRedisPattern);

    // Build QR payload
    const expiresAt = dayjs()
      .add(appConfig.qr.expiryMinutes, 'minute')
      .toISOString();

    const payload = {
      productId:      product_id,
      sellerId,
      buyerId:        buyer_id,
      conversationId: conversation.id,
      expiresAt,
      nonce:          crypto.randomUUID(),
    };

    // Encrypt payload → generate token
    const { token, tokenHash } = qrCrypto.generateToken(payload);

    // Store token hash in Redis for fast single-use validation
    const redisTTLSeconds = appConfig.qr.expiryMinutes * 60;
    await this.redis.set(
      CACHE_KEYS.QR_TOKEN(tokenHash),
      {
        productId:      product_id,
        sellerId,
        buyerId:        buyer_id,
        conversationId: conversation.id,
        expiresAt,
      },
      redisTTLSeconds
    );

    // Store in DB for audit trail (hash only, never raw token)
    const qrTransaction = await this.repo.createQRTransaction({
      productId:         product_id,
      conversationId:    conversation.id,
      sellerId,
      buyerId:           buyer_id,
      tokenHash,
      expiresAt,
      ipAddress:         deviceInfo.ipAddress,
      deviceFingerprint: deviceInfo.deviceFingerprint,
    });

    // Mark product as reserved while QR is active
    if (product.status === 'available') {
      await this.supabase
        .from('products')
        .update({
          status:     PRODUCT_STATUS.RESERVED,
          updated_at: new Date().toISOString(),
        })
        .eq('id', product_id);

      await this.redis.del(CACHE_KEYS.PRODUCT(product_id));
    }

    // Generate QR code image (base64 data URL)
    const qrCodeDataURL = await QRCode.toDataURL(token, {
      errorCorrectionLevel: 'H',
      type:                 'image/png',
      quality:              0.95,
      margin:               2,
      color: {
        dark:  '#000000',
        light: '#FFFFFF',
      },
      width: 400,
    });

    // ── Send push notification to buyer ─────────────────────
    await this.notificationService.createNotification({
      userId: buyer_id,
      type:   constants.NOTIFICATION_TYPES.QR_GENERATED,
      title:  'QR Code Ready! 📱',
      body:   `Seller has generated a QR code for ${product.title}. Open chat and scan it to complete the purchase.`,
      data:   {
        productId:      product_id,
        conversationId: conversation.id,
        transactionId:  qrTransaction.id,
      },
    });

    // ── ✅ Emit real-time socket event to buyer ──────────────
    // Instantly notifies buyer inside the chat room
    if (this.fastify && this.fastify.chatGateway) {
      this.fastify.chatGateway.emitQRGenerated(conversation.id, {
        productId:  product_id,
        sellerId,
        buyerId:    buyer_id,
        expiresAt,
      });
    }

    logger.info(
      {
        sellerId,
        buyerId:       buyer_id,
        productId:     product_id,
        transactionId: qrTransaction.id,
        expiresAt,
      },
      'QR code generated'
    );

    return {
      transaction_id:     qrTransaction.id,
      qr_code:            qrCodeDataURL,
      expires_at:         expiresAt,
      expires_in_minutes: appConfig.qr.expiryMinutes,
      // In test mode, expose raw token for integration testing
      ...(process.env.NODE_ENV === 'test' && { raw_token: token }),
      product: {
        id:       product.id,
        title:    product.title,
        price:    product.price,
        currency: product.currency,
      },
    };
  }

  // ─────────────────────────────────────────
  // SCAN QR CODE
  // Buyer scans — validates and completes sale atomically
  // ─────────────────────────────────────────
  async scanQR(buyerId, token, deviceInfo = {}) {
    // Step 1: Decrypt the token
    const payload = qrCrypto.decrypt(token);

    if (!payload) {
      logger.warn(
        { buyerId, ip: deviceInfo.ipAddress },
        'Invalid QR token decryption attempt'
      );
      throw new AppError(
        'Invalid QR code. Please ask the seller to generate a new one.',
        400,
        'INVALID_QR_TOKEN'
      );
    }

    // Step 2: Verify buyer identity
    if (payload.buyerId !== buyerId) {
      logger.warn(
        {
          expectedBuyerId: payload.buyerId,
          actualBuyerId:   buyerId,
          productId:       payload.productId,
        },
        'QR scan attempt by wrong buyer'
      );
      throw new ForbiddenError(
        'This QR code was not generated for your account'
      );
    }

    // Step 3: Check expiry from payload
    if (dayjs().isAfter(dayjs(payload.expiresAt))) {
      throw new AppError(
        'QR code has expired. Please ask the seller to generate a new one.',
        400,
        'QR_EXPIRED'
      );
    }

    // Step 4: Atomic single-use check via Redis GETDEL
    const tokenHash   = qrCrypto.hash(token);
    let cachedToken   = await this.redis.getdel(CACHE_KEYS.QR_TOKEN(tokenHash));

    if (!cachedToken) {
      const dbRecord = await this.repo.findQRByTokenHash(tokenHash);

      if (dbRecord && dbRecord.status === 'scanned') {
        throw new AppError(
          'This QR code has already been used.',
          400,
          'QR_ALREADY_USED'
        );
      }

      if (dbRecord && dbRecord.status === 'cancelled') {
        throw new AppError(
          'QR code has been cancelled. Please ask the seller to generate a new one.',
          400,
          'QR_INVALID_OR_EXPIRED'
        );
      }

      if (
        dbRecord &&
        dbRecord.status === 'pending' &&
        !dayjs().isAfter(dayjs(dbRecord.expires_at))
      ) {
        logger.warn(
          { tokenHash, transactionId: dbRecord.id },
          'Redis GETDEL returned null for pending QR — falling back to DB validation'
        );
        cachedToken = {
          productId:      payload.productId,
          sellerId:       payload.sellerId,
          buyerId:        payload.buyerId,
          conversationId: payload.conversationId,
          expiresAt:      payload.expiresAt,
        };
      } else {
        throw new AppError(
          'QR code is no longer valid. Please ask the seller to generate a new one.',
          400,
          'QR_INVALID_OR_EXPIRED'
        );
      }
    }

    // Step 5: Verify product is still available
    const { data: product, error: productError } = await this.supabase
      .from('products')
      .select('id, seller_id, status, title, price, currency, store_id')
      .eq('id', payload.productId)
      .single();

    if (productError || !product) {
      throw new NotFoundError('Product');
    }

    if (product.status === PRODUCT_STATUS.SOLD) {
      throw new AppError(
        'This product has already been sold.',
        400,
        'PRODUCT_ALREADY_SOLD'
      );
    }

    // Step 6: Find the QR transaction DB record
    const dbRecordFull = await this.repo.findQRByTokenHash(tokenHash);
    if (!dbRecordFull) {
      throw new AppError('QR transaction record missing in DB', 500);
    }
    const qrTransactionId = dbRecordFull.id;

    // ── Complete the sale via atomic RPC ─────────────────────
    await this.repo.completeSaleTransaction({
      productId: payload.productId,
      qrTransactionId: qrTransactionId,
      sellerId: payload.sellerId,
      buyerId: payload.buyerId,
      conversationId: payload.conversationId
    });

    // ── Update conversation last message ─────────────────────
    await this.supabase
      .from('conversations')
      .update({
        last_message_at:      new Date().toISOString(),
        last_message_preview: '✅ Deal Completed!',
        updated_at:           new Date().toISOString(),
        status:               'completed'
      })
      .eq('id', payload.conversationId);

    // ── Emit socket event to both parties ───────
    if (this.fastify && this.fastify.chatGateway) {
      this.fastify.chatGateway.io
        .to(`conversation:${payload.conversationId}`)
        .emit('sale_completed', {
          productId: payload.productId,
          transactionId: qrTransactionId,
          sellerId: payload.sellerId,
          buyerId: payload.buyerId
        });
    }

    // ── Send push notification to seller ─────────────────────
    await this.notificationService.createNotification({
      userId: payload.sellerId,
      type:   constants.NOTIFICATION_TYPES.SALE_COMPLETED,
      title:  '✅ Sale Completed!',
      body:   `${product.title} has been successfully sold to the buyer.`,
      data: {
        productId:      payload.productId,
        conversationId: payload.conversationId,
        transactionId:  qrTransactionId,
      },
    });

    // ── Award Badges (async) ─────────────────────
    this.badgeEngine.evaluateBadges(payload.sellerId, 'sale_completed').catch((err) =>
      logger.error({ err, sellerId: payload.sellerId }, 'Badge evaluation failed')
    );
    this.badgeEngine.evaluateBadges(payload.buyerId, 'purchase_completed').catch((err) =>
      logger.error({ err, buyerId: payload.buyerId }, 'Badge evaluation failed')
    );

    logger.info(
      {
        sellerId: payload.sellerId,
        buyerId: payload.buyerId,
        productId: payload.productId,
        transactionId: qrTransactionId,
      },
      'Sale completed successfully via QR scan'
    );

    return {
      transaction_id: qrTransactionId,
      product: {
        id:       product.id,
        title:    product.title,
        price:    product.price,
        currency: product.currency,
      },
      seller_id: payload.sellerId,
      buyer_id: payload.buyerId,
    };
  }

  // ─────────────────────────────────────────
  // CANCEL QR
  // Seller cancels before buyer scans
  // ─────────────────────────────────────────
  async cancelQR(sellerId, productId, reason = null) {
    const { data: product } = await this.supabase
      .from('products')
      .select('id, seller_id, status')
      .eq('id', productId)
      .single();

    if (!product) throw new NotFoundError('Product');

    if (product.seller_id !== sellerId) {
      throw new ForbiddenError('You do not own this product');
    }

    // Find and cancel pending QR
    const activeQR = await this.repo.findActiveQRForProduct(productId);

    if (!activeQR) {
      throw new AppError('No active QR code found for this product', 404);
    }

    // Remove from Redis (invalidate immediately)
    await this.redis.del(CACHE_KEYS.QR_TOKEN(activeQR.token_hash));

    // Update DB status
    await this.repo.markQRCancelled(activeQR.id, reason);

    // Revert product status to available if it was reserved by QR
    if (product.status === PRODUCT_STATUS.RESERVED) {
      await this.supabase
        .from('products')
        .update({
          status:     PRODUCT_STATUS.AVAILABLE,
          updated_at: new Date().toISOString(),
        })
        .eq('id', productId);

      await this.redis.del(CACHE_KEYS.PRODUCT(productId));
    }

    logger.info({ sellerId, productId }, 'QR cancelled');

    return { message: 'QR code cancelled. Product is available again.' };
  }

  // ─────────────────────────────────────────
  // REGENERATE QR
  // After cancellation or deal falls through post-scan
  // ─────────────────────────────────────────
  async regenerateQR(sellerId, data, deviceInfo = {}) {
    const { product_id, buyer_id } = data;

    const { data: product } = await this.supabase
      .from('products')
      .select('id, seller_id, status')
      .eq('id', product_id)
      .single();

    if (!product) throw new NotFoundError('Product');
    if (product.seller_id !== sellerId) {
      throw new ForbiddenError('You do not own this product');
    }

    // If product was sold (post-scan deal cancelled), reactivate it first
    if (product.status === PRODUCT_STATUS.SOLD) {
      await this.repo.reactivateProduct(product_id, sellerId);
      await this.redis.del(CACHE_KEYS.PRODUCT(product_id));
      logger.info({ sellerId, product_id }, 'Product reactivated for QR regeneration');
    }

    // Cancel all existing pending QRs
    await this.repo.cancelAllPendingQRsForProduct(
      product_id,
      'regenerated_after_cancellation'
    );

    // Generate fresh QR
    return this.generateQR(sellerId, { product_id, buyer_id }, deviceInfo);
  }

  // ─────────────────────────────────────────
  // GET ACTIVE QR STATUS
  // Seller checks if their QR is still active
  // ─────────────────────────────────────────
  async getActiveQRStatus(sellerId, productId) {
    const { data: product } = await this.supabase
      .from('products')
      .select('id, seller_id')
      .eq('id', productId)
      .single();

    if (!product) throw new NotFoundError('Product');
    if (product.seller_id !== sellerId) {
      throw new ForbiddenError('Access denied');
    }

    const activeQR = await this.repo.findActiveQRForProduct(productId);

    if (!activeQR) {
      return { has_active_qr: false };
    }

    const now             = dayjs();
    const expiresAt       = dayjs(activeQR.expires_at);
    const minutesRemaining = expiresAt.diff(now, 'minute');

    return {
      has_active_qr:     true,
      transaction_id:    activeQR.id,
      expires_at:        activeQR.expires_at,
      minutes_remaining: Math.max(0, minutesRemaining),
      status:            activeQR.status,
    };
  }
}

module.exports = QRService;