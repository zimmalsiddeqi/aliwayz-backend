'use strict';

let Filter;
let filter;

// ─────────────────────────────────────────
// Safely load bad-words — fallback if not installed
// ─────────────────────────────────────────
try {
  Filter = require('bad-words');
  filter = new Filter();
} catch (err) {
  // bad-words not installed — use basic fallback
  filter = null;
}

// Basic fallback word list (minimal)
const BASIC_BLOCKED = ['spam', 'scam'];

/**
 * Check if text contains profanity
 */
const containsProfanity = (text) => {
  if (!text || typeof text !== 'string') return false;

  if (filter) {
    try {
      return filter.isProfane(text);
    } catch {
      return false;
    }
  }

  // Fallback: basic check
  const lower = text.toLowerCase();
  return BASIC_BLOCKED.some((word) => lower.includes(word));
};

/**
 * Clean profanity from text
 */
const cleanText = (text) => {
  if (!text || typeof text !== 'string') return text;

  if (filter) {
    try {
      return filter.clean(text);
    } catch {
      return text;
    }
  }

  return text;
};

module.exports = { containsProfanity, cleanText };