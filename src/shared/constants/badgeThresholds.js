'use strict';

const BADGE_THRESHOLDS = Object.freeze({
  NEW_SELLER: {
    code: 'new_seller',
    name: 'New Seller',
    minSales: 0,
    minRating: 0,
    minReviews: 0,
    requiresPhoneVerify: false,
    badgeScore: 10,
  },
  VERIFIED_SELLER: {
    code: 'verified_seller',
    name: 'Verified Seller',
    minSales: 1,
    minRating: 0,
    minReviews: 0,
    requiresPhoneVerify: true,
    badgeScore: 30,
  },
  RATED_100: {
    code: '100_rated',
    name: '100 Rated Seller',
    minSales: 100,
    minRating: 4.0,
    minReviews: 80,
    requiresPhoneVerify: false,
    badgeScore: 60,
  },
  RATED_500: {
    code: '500_rated',
    name: '500 Rated Seller',
    minSales: 500,
    minRating: 4.2,
    minReviews: 400,
    requiresPhoneVerify: false,
    badgeScore: 90,
  },
  TOP_SELLER: {
    code: 'top_seller',
    name: 'Top Seller',
    minSales: 500,
    minRating: 4.5,
    minReviews: 400,
    requiresPhoneVerify: true,
    badgeScore: 100,
  },
  TRUSTED_BUYER: {
    code: 'trusted_buyer',
    name: 'Trusted Buyer',
    minPurchases: 10,
    minRating: 4.5,
    requiresPhoneVerify: false,
    badgeScore: 50,
  },
});

module.exports = { BADGE_THRESHOLDS };