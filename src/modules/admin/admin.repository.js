'use strict';

const logger = require('../../shared/utils/logger');

class AdminRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Dashboard analytics overview
  // ─────────────────────────────────────────
  async getDashboardStats() {
    const [
      { count: totalUsers },
      { count: totalProducts },
      { count: totalStores },
      { count: totalSales },
      { count: pendingReports },
      { count: newUsersToday },
    ] = await Promise.all([
      this.supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false),
      this.supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false),
      this.supabase
        .from('stores')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false),
      this.supabase
        .from('qr_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'scanned'),
      this.supabase
        .from('reports')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      this.supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 86400000).toISOString()),
    ]);

    return {
      total_users: totalUsers || 0,
      total_products: totalProducts || 0,
      total_stores: totalStores || 0,
      total_sales: totalSales || 0,
      pending_reports: pendingReports || 0,
      new_users_today: newUsersToday || 0,
    };
  }

  // ─────────────────────────────────────────
  // Get all users with filters
  // ─────────────────────────────────────────
  async getAllUsers({ status, role, search, limit, offset }) {
    let query = this.supabase
      .from('users')
      .select(
        'id, email, username, full_name, role, account_status, email_verified, phone_verified, created_at, last_active_at',
        { count: 'exact' }
      )
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('account_status', status);
    if (role) query = query.eq('role', role);
    if (search) {
      query = query.or(
        `username.ilike.%${search}%,email.ilike.%${search}%,full_name.ilike.%${search}%`
      );
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Get single user with full details
  // ─────────────────────────────────────────
  async getUserDetail(userId) {
    const { data, error } = await this.supabase
      .from('users')
      .select(`
        *,
        seller_stats (*),
        user_badges (
          is_active,
          awarded_at,
          badges (code, name, icon_url)
        )
      `)
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  }

  // ─────────────────────────────────────────
  // Update user account status
  // ─────────────────────────────────────────
  async updateUserStatus(userId, status, adminId, reason) {
    const { data, error } = await this.supabase
      .from('users')
      .update({
        account_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('id, username, account_status')
      .single();

    if (error) throw error;

    // Log admin action
    await this._logAdminAction(adminId, `user_status_${status}`, 'user', userId, { reason });

    return data;
  }

  // ─────────────────────────────────────────
  // Hard delete user (GDPR / severe violation)
  // ─────────────────────────────────────────
  async hardDeleteUser(userId, adminId) {
    // Anonymize before delete to maintain referential integrity
    const { error } = await this.supabase
      .from('users')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        email: `admin_deleted_${userId}@deleted.invalid`,
        username: `deleted_${userId.substring(0, 8)}`,
        full_name: null,
        bio: null,
        phone: null,
        avatar_url: null,
        fcm_token: null,
      })
      .eq('id', userId);

    if (error) throw error;

    await this._logAdminAction(adminId, 'user_hard_deleted', 'user', userId, {});
  }

  // ─────────────────────────────────────────
  // Get all stores
  // ─────────────────────────────────────────
  async getAllStores({ search, isVerified, limit, offset }) {
    let query = this.supabase
      .from('stores')
      .select(
        `
        id,
        store_name,
        slug,
        logo_url,
        is_verified,
        is_active,
        total_sales,
        average_rating,
        total_followers,
        created_at,
        users:user_id (
          id,
          username,
          email
        )
      `,
        { count: 'exact' }
      )
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (search) query = query.ilike('store_name', `%${search}%`);
    if (isVerified !== undefined) query = query.eq('is_verified', isVerified);
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Verify / unverify store
  // ─────────────────────────────────────────
  async setStoreVerification(storeId, isVerified, adminId) {
    const { data, error } = await this.supabase
      .from('stores')
      .update({
        is_verified: isVerified,
        updated_at: new Date().toISOString(),
      })
      .eq('id', storeId)
      .select('id, store_name, is_verified')
      .single();

    if (error) throw error;

    await this._logAdminAction(
      adminId,
      isVerified ? 'store_verified' : 'store_unverified',
      'store',
      storeId,
      {}
    );

    return data;
  }

  // ─────────────────────────────────────────
  // Get all products (admin)
  // ─────────────────────────────────────────
  async getAllProducts({ status, search, limit, offset }) {
    let query = this.supabase
      .from('products')
      .select(
        `
        id,
        title,
        slug,
        price,
        currency,
        status,
        is_featured,
        view_count,
        created_at,
        users:seller_id (
          id,
          username
        ),
        stores (
          id,
          store_name
        )
      `,
        { count: 'exact' }
      )
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (search) query = query.ilike('title', `%${search}%`);
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // Feature / unfeature product
  // ─────────────────────────────────────────
  async setProductFeatured(productId, isFeatured, featuredUntil, adminId) {
    const { data, error } = await this.supabase
      .from('products')
      .update({
        is_featured: isFeatured,
        featured_until: featuredUntil || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId)
      .select('id, title, is_featured')
      .single();

    if (error) throw error;

    await this._logAdminAction(
      adminId,
      isFeatured ? 'product_featured' : 'product_unfeatured',
      'product',
      productId,
      {}
    );

    return data;
  }

  // ─────────────────────────────────────────
  // Admin delete product
  // ─────────────────────────────────────────
  async adminDeleteProduct(productId, adminId, reason) {
    const { error } = await this.supabase
      .from('products')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        status: 'hidden',
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId);

    if (error) throw error;

    await this._logAdminAction(adminId, 'product_deleted', 'product', productId, { reason });
  }

  // ─────────────────────────────────────────
  // Get admin audit logs
  // ─────────────────────────────────────────
  async getAdminLogs({ adminId, action, limit, offset }) {
    let query = this.supabase
      .from('admin_logs')
      .select(
        `
        id,
        action,
        target_type,
        target_id,
        metadata,
        ip_address,
        created_at,
        admin:admin_id (
          id,
          username
        )
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    if (adminId) query = query.eq('admin_id', adminId);
    if (action) query = query.eq('action', action);
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // PRIVATE: Log admin action
  // ─────────────────────────────────────────
  async _logAdminAction(adminId, action, targetType, targetId, metadata) {
    await this.supabase.from('admin_logs').insert({
      admin_id: adminId,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
    });
  }
}

module.exports = AdminRepository;