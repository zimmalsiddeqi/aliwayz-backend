'use strict';

const slugifyLib = require('slugify');
const { v4: uuidv4 } = require('uuid');

/**
 * Creates a URL-safe slug from a string
 * Appends short UUID to ensure uniqueness
 */
const createSlug = (text) => {
  const base = slugifyLib(text, {
    lower: true,
    strict: true,
    trim: true,
  });
  // 8-char unique suffix for collision prevention
  const suffix = uuidv4().replace(/-/g, '').substring(0, 8);
  return `${base}-${suffix}`;
};

module.exports = { createSlug };