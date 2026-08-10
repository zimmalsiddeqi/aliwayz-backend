'use strict';

const AppError = require('./AppError');

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

module.exports = UnauthorizedError;