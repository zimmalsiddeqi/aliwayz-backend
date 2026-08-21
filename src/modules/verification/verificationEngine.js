'use strict';

class VerificationEngine {
  /**
   * @param {Object} provider The verification provider (e.g. ManualVerificationProvider)
   */
  constructor(provider) {
    this.provider = provider;
  }

  /**
   * Checks if user has a verified identity status.
   * Other modules must check this function to grant privileges.
   * 
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async isVerified(userId) {
    return this.provider.checkVerifiedStatus(userId);
  }
}

module.exports = VerificationEngine;
