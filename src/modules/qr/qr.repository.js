'use strict';

const logger = require('../../shared/utils/logger');

class QRRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Store new QR transaction record
  // ─────────────────────────────────────────
  async createQRTransaction(data) {
    const { data: record, error } = await this.supabase
      .from('qr_transactions')
      .insert({
        product_id: data.productId,
        conversation_id: data.conversationId,
        seller_id: data.sellerId,
        buyer_id: data.buyerId,
        token_hash: data.tokenHash,
        status: 'pending',
        generated_at: new Date().toISOString(),
        expires_at: data.expiresAt,
        ip_address: data.ipAddress || null,
        device_fingerprint: data.deviceFingerprint || null,
      })
      .select('id, product_id, seller_id, buyer_id, status, expires_at')
      .single();

    if (error) {
      logger.error({ error }, 'createQRTransaction failed');
      throw error;
    }

    return record;
  }

  // ─────────────────────────────────────────
  // Find active QR transaction for a product
  // (pending and not expired)
  // ─────────────────────────────────────────
  async findActiveQRForProduct(productId) {
    const { data, error } = await this.supabase
      .from('qr_transactions')
      .select('id, product_id, seller_id, buyer_id, token_hash, status, expires_at, generated_at')
      .eq('product_id', productId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('generated_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findActiveQRForProduct failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Find QR transaction by token hash
  // ─────────────────────────────────────────
  async findQRByTokenHash(tokenHash) {
    const { data, error } = await this.supabase
      .from('qr_transactions')
      .select('id, product_id, conversation_id, seller_id, buyer_id, status, expires_at')
      .eq('token_hash', tokenHash)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findQRByTokenHash failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Mark QR as scanned (used)
  // ─────────────────────────────────────────
  async markQRScanned(transactionId) {
    const { error } = await this.supabase
      .from('qr_transactions')
      .update({
        status: 'scanned',
        scanned_at: new Date().toISOString(),
      })
      .eq('id', transactionId);

    if (error) {
      logger.error({ error }, 'markQRScanned failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Mark QR as cancelled
  // ─────────────────────────────────────────
  async markQRCancelled(transactionId, reason = null) {
    const { error } = await this.supabase
      .from('qr_transactions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq('id', transactionId);

    if (error) {
      logger.error({ error }, 'markQRCancelled failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Cancel all pending QRs for a product
  // (before regenerating)
  // ─────────────────────────────────────────
  async cancelAllPendingQRsForProduct(productId, reason) {
    const { error } = await this.supabase
      .from('qr_transactions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq('product_id', productId)
      .eq('status', 'pending');

    if (error) {
      logger.error({ error }, 'cancelAllPendingQRsForProduct failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Complete the sale — full atomic transaction
  // Uses Supabase RPC to ensure all-or-nothing
  // ─────────────────────────────────────────
  async completeSaleTransaction(data) {
    const { data: result, error } = await this.supabase.rpc(
      'complete_sale_transaction',
      {
        p_product_id: data.productId,
        p_qr_transaction_id: data.qrTransactionId,
        p_seller_id: data.sellerId,
        p_buyer_id: data.buyerId,
        p_conversation_id: data.conversationId,
      }
    );

    if (error) {
      logger.error({ error }, 'completeSaleTransaction RPC failed');
      throw error;
    }

    return result;
  }

  // ─────────────────────────────────────────
  // Reactivate a sold product listing
  // (used when deal cancelled after QR scan)
  // ─────────────────────────────────────────
  async reactivateProduct(productId, sellerId) {
    const { error } = await this.supabase
      .from('products')
      .update({
        status: 'available',
        sold_at: null,
        auto_remove_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId)
      .eq('seller_id', sellerId)
      .eq('status', 'sold');

    if (error) {
      logger.error({ error }, 'reactivateProduct failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Get QR transaction history for a seller
  // ─────────────────────────────────────────
  async getSellerTransactionHistory(sellerId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('qr_transactions')
      .select(
        `
        id,
        status,
        generated_at,
        scanned_at,
        expires_at,
        products (
          id,
          title,
          slug,
          price,
          currency
        ),
        buyer:buyer_id (
          id,
          username,
          avatar_url
        )
      `,
        { count: 'exact' }
      )
      .eq('seller_id', sellerId)
      .order('generated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getSellerTransactionHistory failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }
}

module.exports = QRRepository;