'use strict';

/**
 * Extracts pagination params from query string
 * Enforces max limit to prevent abuse
 */
const getPaginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

module.exports = { getPaginationParams };