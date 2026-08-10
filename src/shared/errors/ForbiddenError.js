'use strict';

const AppError = require('./AppError');

class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

module.exports = ForbiddenError;