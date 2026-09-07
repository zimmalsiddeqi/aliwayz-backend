'use strict';

const logger = require('../../shared/utils/logger');

class BlockRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Block a user
  // ─────────────────────────────────────────
  async blockUser(blockerId, blockedId) {
    const { data, error } = await this.supabase
      .from('user_blocks')
      .insert({
        blocker_id: blockerId,
        blocked_id: blockedId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return { message: 'User is already blocked' };
      }
      logger.error({ error, blockerId, blockedId }, 'blockUser failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Unblock a user
  // ─────────────────────────────────────────
  async unblockUser(blockerId, blockedId) {
    const { error } = await this.supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);

    if (error) {
      logger.error({ error, blockerId, blockedId }, 'unblockUser failed');
      throw error;
    }

    return { message: 'User unblocked successfully' };
  }

  // ─────────────────────────────────────────
  // Get list of blocked users for a blocker
  // ─────────────────────────────────────────
  async getBlockedUsers(blockerId) {
    const { data, error } = await this.supabase
      .from('user_blocks')
      .select(`
        id,
        blocked_id,
        created_at,
        blocked:blocked_id (
          id,
          username,
          full_name,
          avatar_url
        )
      `)
      .eq('blocker_id', blockerId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error({ error, blockerId }, 'getBlockedUsers failed');
      throw error;
    }

    return data || [];
  }

  // ─────────────────────────────────────────
  // Get IDs of all users blocked BY or blocking user (2-way block filter)
  // ─────────────────────────────────────────
  async getBlockedUserIds(userId) {
    if (!userId) return [];

    const [{ data: blockedByMe }, { data: blockingMe }] = await Promise.all([
      this.supabase
        .from('user_blocks')
        .select('blocked_id')
        .eq('blocker_id', userId),
      this.supabase
        .from('user_blocks')
        .select('blocker_id')
        .eq('blocked_id', userId),
    ]);

    const ids = new Set();
    (blockedByMe || []).forEach((b) => ids.add(b.blocked_id));
    (blockingMe || []).forEach((b) => ids.add(b.blocker_id));

    return Array.from(ids);
  }
}

module.exports = BlockRepository;
