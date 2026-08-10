'use strict';

/**
 * Sanitizes string inputs to prevent XSS
 * Only encodes < and > which are dangerous for HTML injection
 * Does NOT encode quotes/apostrophes — they are safe in JSON responses
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
};

const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

/**
 * Fastify preHandler — sanitizes request body and query params
 */
const sanitizeInput = async (request) => {
  if (request.body) {
    request.body = sanitizeObject(request.body);
  }
  if (request.query) {
    request.query = sanitizeObject(request.query);
  }
};

module.exports = { sanitizeInput, sanitizeString, sanitizeObject };