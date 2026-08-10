'use strict';

const ROLES = Object.freeze({
  GUEST: 'guest',
  BUYER: 'buyer',
  SELLER: 'seller',
  BOTH: 'both',
  ADMIN: 'admin',
});

// Roles that have seller capabilities
const SELLER_ROLES = [ROLES.SELLER, ROLES.BOTH, ROLES.ADMIN];

// Roles that have buyer capabilities
const BUYER_ROLES = [ROLES.BUYER, ROLES.BOTH, ROLES.ADMIN];

module.exports = { ROLES, SELLER_ROLES, BUYER_ROLES };