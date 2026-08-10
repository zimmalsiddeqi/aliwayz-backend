'use strict';

const logger = require('../../shared/utils/logger');

class ReportRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Create report
  // ─────────────────────────────────────────
  async createReport(reportData) {
    const { data, error } = await this.supabase
      .from('reports')
      .insert(reportData)
      .select('id, target_type, reason, status, created_at')
      .single();

    if (error) {
      logger.error({ error }, 'createReport failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Check for duplicate report
  // ─────────────────────────────────────────
  async findDuplicateReport(reporterId, targetType, targetId) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('reports')
      .select('id')
      .eq('reporter_id', reporterId)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .gte('created_at', oneDayAgo)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }

  // ─────────────────────────────────────────
  // Get reports submitted by a user
  // ─────────────────────────────────────────
  async getReporterReports(reporterId, { limit, offset }) {
    const { data, error, count } = await this.supabase
      .from('reports')
      .select(
        'id, target_type, target_id, reason, description, status, created_at',
        { count: 'exact' }
      )
      .eq('reporter_id', reporterId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getReporterReports failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Admin: Get all reports (paginated + filterable)
  // ─────────────────────────────────────────
  async getAllReports({ status, targetType, limit, offset }) {
    let query = this.supabase
      .from('reports')
      .select(
        `
        id,
        target_type,
        target_id,
        reason,
        description,
        status,
        resolution_note,
        created_at,
        updated_at,
        reporter:reporter_id (
          id,
          username,
          email
        ),
        resolver:resolved_by (
          id,
          username
        )
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (targetType) query = query.eq('target_type', targetType);

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error({ error }, 'getAllReports failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Admin: Update report status
  // ─────────────────────────────────────────
  async resolveReport(reportId, adminId, status, resolutionNote) {
    const { data, error } = await this.supabase
      .from('reports')
      .update({
        status,
        resolved_by: adminId,
        resolved_at: new Date().toISOString(),
        resolution_note: resolutionNote || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reportId)
      .select('id, status, resolved_at')
      .single();

    if (error) {
      logger.error({ error }, 'resolveReport failed');
      throw error;
    }

    return data;
  }
}

module.exports = ReportRepository;