'use strict';

/**
 * Standardized API response format
 * All responses follow this structure for consistency
 */

const successResponse = (data, message = 'Success', meta = null) => {
  const response = {
    success: true,
    message,
    data,
  };
  if (meta) response.meta = meta;
  return response;
};

const errorResponse = (message, code = null, errors = null) => {
  const response = {
    success: false,
    message,
  };
  if (code) response.code = code;
  if (errors) response.errors = errors;
  return response;
};

const paginatedResponse = (data, pagination) => ({
  success: true,
  data,
  pagination: {
    page: pagination.page,
    limit: pagination.limit,
    total: pagination.total,
    totalPages: Math.ceil(pagination.total / pagination.limit),
    hasNextPage: pagination.page < Math.ceil(pagination.total / pagination.limit),
    hasPrevPage: pagination.page > 1,
  },
});

module.exports = { successResponse, errorResponse, paginatedResponse };