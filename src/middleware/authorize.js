'use strict';

const ForbiddenError = require('../shared/errors/ForbiddenError');
const UnauthorizedError = require('../shared/errors/UnauthorizedError');
const { ROLES, SELLER_ROLES, BUYER_ROLES } = require('../shared/constants/roles');

/**
 * Role-based access control middleware factory
 * Usage: authorize([ROLES.ADMIN, ROLES.SELLER])
 */
const authorize = (allowedRoles = []) => {
  return async (request) => {
    if (!request.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const userRole = request.user.role;

    // Admin always has access
    if (userRole === ROLES.ADMIN) return;

    if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
      throw new ForbiddenError(
        `Access denied. Required role: ${allowedRoles.join(' or ')}`
      );
    }
  };
};

/**
 * Checks if user has seller capabilities
 */
const requireSeller = async (request) => {
  if (!request.user) {
    throw new UnauthorizedError('Authentication required');
  }

  if (!SELLER_ROLES.includes(request.user.role)) {
    throw new ForbiddenError(
      'Seller account required. Update your role to seller.'
    );
  }
};

/**
 * Checks if user has buyer capabilities
 */
const requireBuyer = async (request) => {
  if (!request.user) {
    throw new UnauthorizedError('Authentication required');
  }

  if (!BUYER_ROLES.includes(request.user.role)) {
    throw new ForbiddenError('Buyer account required.');
  }
};

/**
 * Admin only access
 */
const requireAdmin = async (request) => {
  if (!request.user) {
    throw new UnauthorizedError('Authentication required');
  }

  if (request.user.role !== ROLES.ADMIN) {
    throw new ForbiddenError('Admin access required');
  }
};

/**
 * Checks if user is authorized to perform verification reviews
 */
const requireVerificationOfficer = async (request) => {
  await requireAdmin(request);
  
  // Custom metadata/claim check. In a production scenario, we can inspect a claims object or metadata.
  // For backward compatibility, any admin is allowed unless explicitly disabled (can_verify_sellers === false)
  if (request.user.can_verify_sellers === false) {
    throw new ForbiddenError('Access denied. Verification review privileges required.');
  }
};

module.exports = {
  authorize,
  requireSeller,
  requireBuyer,
  requireAdmin,
  requireVerificationOfficer,
};