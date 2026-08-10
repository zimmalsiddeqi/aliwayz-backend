'use strict';

const ReportRepository = require('./report.repository');
const { getPaginationParams } = require('../../shared/utils/paginate');
const { containsProfanity } = require('../../shared/utils/profanityFilter');
const logger = require('../../shared/utils/logger');

const AppError = require('../../shared/errors/AppError');

class ReportService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new ReportRepository(supabase);
  }

  // ─────────────────────────────────────────
  // SUBMIT REPORT
  // ─────────────────────────────────────────
  async submitReport(reporterId, data) {
    const { target_type, target_id, reason, description } = data;

    // Cannot report yourself
    if (target_type === 'user' && target_id === reporterId) {
      throw new AppError('You cannot report yourself', 400);
    }

    // Check duplicate report in last 24hrs
    const isDuplicate = await this.repo.findDuplicateReport(
      reporterId,
      target_type,
      target_id
    );

    if (isDuplicate) {
      throw new AppError(
        'You have already reported this within the last 24 hours.',
        409,
        'DUPLICATE_REPORT'
      );
    }

    // Verify target exists
    await this._verifyTargetExists(target_type, target_id);

    const report = await this.repo.createReport({
      reporter_id: reporterId,
      target_type,
      target_id,
      reason,
      description: description || null,
      status: 'pending',
    });

    logger.info(
      { reporterId, targetType: target_type, targetId: target_id, reason },
      'Report submitted'
    );

    return report;
  }

  // ─────────────────────────────────────────
  // GET MY REPORTS
  // ─────────────────────────────────────────
  async getMyReports(userId, query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getReporterReports(userId, {
      limit,
      offset,
    });
    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // ADMIN: GET ALL REPORTS
  // ─────────────────────────────────────────
  async getAllReports(query) {
    const { page, limit, offset } = getPaginationParams(query);
    const { data, count } = await this.repo.getAllReports({
      status: query.status,
      targetType: query.target_type,
      limit,
      offset,
    });
    return { data, pagination: { page, limit, total: count } };
  }

  // ─────────────────────────────────────────
  // ADMIN: RESOLVE REPORT
  // ─────────────────────────────────────────
  async resolveReport(adminId, reportId, status, resolutionNote) {
    if (!['resolved', 'dismissed'].includes(status)) {
      throw new AppError(
        'Status must be resolved or dismissed',
        400,
        'INVALID_STATUS'
      );
    }

    const result = await this.repo.resolveReport(
      reportId,
      adminId,
      status,
      resolutionNote
    );

    logger.info({ adminId, reportId, status }, 'Report resolved by admin');
    return result;
  }

  // ─────────────────────────────────────────
  // PRIVATE: Verify report target exists
  // ─────────────────────────────────────────
  async _verifyTargetExists(targetType, targetId) {
    const tableMap = {
      user: 'users',
      product: 'products',
      store: 'stores',
    };

    const table = tableMap[targetType];
    if (!table) throw new AppError('Invalid target type', 400);

    const { data, error } = await this.supabase
      .from(table)
      .select('id')
      .eq('id', targetId)
      .single();

    if (error || !data) {
      throw new AppError(`${targetType} not found`, 404, 'TARGET_NOT_FOUND');
    }
  }
}

module.exports = ReportService;