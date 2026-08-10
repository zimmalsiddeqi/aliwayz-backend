'use strict';

/**
 * Haversine formula for calculating distance between two geo coordinates
 * Returns distance in kilometers
 *
 * Used as fallback when PostGIS earthdistance is unavailable
 * Primary geo queries use PostgreSQL functions
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Convert degrees to radians
 */
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Calculate distance between two lat/lng points in kilometers
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  if (
    lat1 === null || lng1 === null ||
    lat2 === null || lng2 === null
  ) {
    return null;
  }

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_KM * c * 100) / 100; // Round to 2 decimal places
};

/**
 * Check if a point is within a given radius (km) of a center point
 */
const isWithinRadius = (centerLat, centerLng, pointLat, pointLng, radiusKm) => {
  const distance = calculateDistance(centerLat, centerLng, pointLat, pointLng);
  if (distance === null) return false;
  return distance <= radiusKm;
};

/**
 * Generate approximate geohash for caching nearby queries
 * Precision: ~1.1km per unit
 */
const generateGeohash = (lat, lng, precision = 1) => {
  const factor = Math.pow(10, precision);
  const roundedLat = Math.round(lat * factor) / factor;
  const roundedLng = Math.round(lng * factor) / factor;
  return `${roundedLat}_${roundedLng}`;
};

module.exports = {
  calculateDistance,
  isWithinRadius,
  generateGeohash,
};