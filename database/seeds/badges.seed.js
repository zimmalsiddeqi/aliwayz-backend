'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { BADGE_THRESHOLDS } = require('../../src/shared/constants/badgeThresholds');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const badgeSeedData = [
  {
    code: BADGE_THRESHOLDS.NEW_SELLER.code,
    name: BADGE_THRESHOLDS.NEW_SELLER.name,
    description: 'Awarded to all new sellers when they first create a store.',
    icon_url: null,
    min_sales: BADGE_THRESHOLDS.NEW_SELLER.minSales,
    min_rating: BADGE_THRESHOLDS.NEW_SELLER.minRating,
    min_reviews: BADGE_THRESHOLDS.NEW_SELLER.minReviews,
    requires_phone_verify: BADGE_THRESHOLDS.NEW_SELLER.requiresPhoneVerify,
    badge_score: BADGE_THRESHOLDS.NEW_SELLER.badgeScore,
    display_order: 1,
    is_active: true,
  },
  {
    code: BADGE_THRESHOLDS.VERIFIED_SELLER.code,
    name: BADGE_THRESHOLDS.VERIFIED_SELLER.name,
    description: 'Awarded to sellers who verify their phone number and complete their first sale.',
    icon_url: null,
    min_sales: BADGE_THRESHOLDS.VERIFIED_SELLER.minSales,
    min_rating: BADGE_THRESHOLDS.VERIFIED_SELLER.minRating,
    min_reviews: BADGE_THRESHOLDS.VERIFIED_SELLER.minReviews,
    requires_phone_verify: BADGE_THRESHOLDS.VERIFIED_SELLER.requiresPhoneVerify,
    badge_score: BADGE_THRESHOLDS.VERIFIED_SELLER.badgeScore,
    display_order: 2,
    is_active: true,
  },
  {
    code: BADGE_THRESHOLDS.RATED_100.code,
    name: BADGE_THRESHOLDS.RATED_100.name,
    description: 'Awarded to sellers who complete 100 sales with a 4.0+ rating.',
    icon_url: null,
    min_sales: BADGE_THRESHOLDS.RATED_100.minSales,
    min_rating: BADGE_THRESHOLDS.RATED_100.minRating,
    min_reviews: BADGE_THRESHOLDS.RATED_100.minReviews,
    requires_phone_verify: BADGE_THRESHOLDS.RATED_100.requiresPhoneVerify,
    badge_score: BADGE_THRESHOLDS.RATED_100.badgeScore,
    display_order: 3,
    is_active: true,
  },
  {
    code: BADGE_THRESHOLDS.RATED_500.code,
    name: BADGE_THRESHOLDS.RATED_500.name,
    description: 'Awarded to sellers who complete 500 sales with a 4.2+ rating.',
    icon_url: null,
    min_sales: BADGE_THRESHOLDS.RATED_500.minSales,
    min_rating: BADGE_THRESHOLDS.RATED_500.minRating,
    min_reviews: BADGE_THRESHOLDS.RATED_500.minReviews,
    requires_phone_verify: BADGE_THRESHOLDS.RATED_500.requiresPhoneVerify,
    badge_score: BADGE_THRESHOLDS.RATED_500.badgeScore,
    display_order: 4,
    is_active: true,
  },
  {
    code: BADGE_THRESHOLDS.TOP_SELLER.code,
    name: BADGE_THRESHOLDS.TOP_SELLER.name,
    description: 'The highest seller badge. 500+ sales, 4.5+ rating, phone verified, recently active.',
    icon_url: null,
    min_sales: BADGE_THRESHOLDS.TOP_SELLER.minSales,
    min_rating: BADGE_THRESHOLDS.TOP_SELLER.minRating,
    min_reviews: BADGE_THRESHOLDS.TOP_SELLER.minReviews,
    requires_phone_verify: BADGE_THRESHOLDS.TOP_SELLER.requiresPhoneVerify,
    badge_score: BADGE_THRESHOLDS.TOP_SELLER.badgeScore,
    display_order: 5,
    is_active: true,
  },
  {
    code: BADGE_THRESHOLDS.TRUSTED_BUYER.code,
    name: BADGE_THRESHOLDS.TRUSTED_BUYER.name,
    description: 'Awarded to buyers with 10+ purchases and a 4.5+ buyer rating.',
    icon_url: null,
    min_sales: 0,
    min_rating: BADGE_THRESHOLDS.TRUSTED_BUYER.minRating,
    min_reviews: 0,
    requires_phone_verify: BADGE_THRESHOLDS.TRUSTED_BUYER.requiresPhoneVerify,
    badge_score: BADGE_THRESHOLDS.TRUSTED_BUYER.badgeScore,
    display_order: 6,
    is_active: true,
  },
];

async function seedBadges() {
  console.log('🌱 Seeding badges...');

  for (const badge of badgeSeedData) {
    const { data, error } = await supabase
      .from('badges')
      .upsert(badge, { onConflict: 'code' })
      .select('id, code, name')
      .single();

    if (error) {
      console.error(`❌ Failed to seed badge: ${badge.code}`, error);
    } else {
      console.log(`✅ Badge: ${data.name} (${data.code})`);
    }
  }

  console.log('\n✅ Badge seeding complete!');
  process.exit(0);
}

seedBadges().catch((err) => {
  console.error('Badge seeding failed:', err);
  process.exit(1);
});