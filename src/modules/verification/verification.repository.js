'use strict';

const logger = require('../../shared/utils/logger');

class VerificationRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  /**
   * Find latest verification submission for a user
   */
  async findLatestByUserId(userId) {
    const { data, error } = await this.supabase
      .from('seller_verifications')
      .select('*')
      .eq('user_id', userId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error({ error, userId }, 'findLatestByUserId failed');
      throw error;
    }
    return data;
  }

  /**
   * Check if a document hash has already been verified/approved under a different user
   */
  async findDuplicateHash(hash, currentUserId) {
    const { data, error } = await this.supabase
      .from('seller_verifications')
      .select('user_id')
      .eq('document_hash', hash)
      .eq('status', 'approved')
      .neq('user_id', currentUserId)
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error({ error, hash }, 'findDuplicateHash failed');
      throw error;
    }
    return data;
  }

  /**
   * Count total verification attempts by a user
   */
  async countAttemptsByUserId(userId) {
    const { count, error } = await this.supabase
      .from('seller_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      logger.error({ error, userId }, 'countAttemptsByUserId failed');
      throw error;
    }
    return count || 0;
  }

  /**
   * Create verification submission
   */
  async createSubmission(data) {
    const { data: record, error } = await this.supabase
      .from('seller_verifications')
      .insert(data)
      .select('*')
      .single();

    if (error) {
      logger.error({ error, data }, 'createSubmission failed');
      throw error;
    }
    return record;
  }

  /**
   * Retrieve verification attempt by ID
   */
  async findSubmissionById(id) {
    const { data, error } = await this.supabase
      .from('seller_verifications')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      logger.error({ error, id }, 'findSubmissionById failed');
      throw error;
    }
    return data;
  }

  /**
   * Fetch verification submissions (Admin dashboard)
   */
  async getPendingSubmissions({ status, limit, offset }) {
    let query = this.supabase
      .from('seller_verifications')
      .select('*, users:user_id(id, email, username)', { count: 'exact' });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    query = query.order('submitted_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      logger.error({ error }, 'getPendingSubmissions failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  /**
   * Insert audit log record
   */
  async createAuditLog(logData) {
    const { error } = await this.supabase
      .from('seller_verification_audit_logs')
      .insert(logData);

    if (error) {
      logger.error({ error, logData }, 'createAuditLog failed');
      throw error;
    }
  }

  /**
   * Save store draft parameters
   */
  async saveStoreDraft(userId, draftData) {
    const { data, error } = await this.supabase
      .from('store_drafts')
      .upsert({
        user_id: userId,
        store_name: draftData.store_name,
        description: draftData.description || null,
        category_id: draftData.category_id || null,
        location_city: draftData.location_city || null,
        location_lat: draftData.location_lat || null,
        location_lng: draftData.location_lng || null,
        social_instagram: draftData.social_instagram || null,
        social_facebook: draftData.social_facebook || null,
        social_tiktok: draftData.social_tiktok || null,
        logo_url: draftData.logo_url || null,
        banner_url: draftData.banner_url || null,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ error, userId, draftData }, 'saveStoreDraft failed');
      throw error;
    }
    return data;
  }

  /**
   * Get store draft by owner user ID
   */
  async findStoreDraftByUserId(userId) {
    const { data, error } = await this.supabase
      .from('store_drafts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error({ error, userId }, 'findStoreDraftByUserId failed');
      throw error;
    }
    return data;
  }

  /**
   * Remove store draft record
   */
  async deleteStoreDraft(userId) {
    const { error } = await this.supabase
      .from('store_drafts')
      .delete()
      .eq('user_id', userId);

    if (error) {
      logger.error({ error, userId }, 'deleteStoreDraft failed');
      throw error;
    }
  }
}

module.exports = VerificationRepository;
