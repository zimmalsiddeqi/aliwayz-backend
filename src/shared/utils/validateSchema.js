'use strict';

const ValidationError = require('../errors/ValidationError');

const validateSchema = (schema, data) => {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errors = [];

    try {
      if (result.error?.errors) {
        result.error.errors.forEach((e) => {
          errors.push({
            field: e.path?.join('.') || 'unknown',
            message: e.message,
            received: e.received,
          });
        });
      }
    } catch {
      errors.push({ field: 'unknown', message: 'Validation failed' });
    }

    // Log for debugging
    const logger = require('./logger');
    logger.warn({ errors, input: data }, 'Validation failed');

    throw new ValidationError('Validation failed', errors);
  }

  return result.data;
};

module.exports = { validateSchema };