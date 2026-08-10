'use strict';

const logger = require('../../shared/utils/logger');

class CategoryRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────
  // Get full category tree
  // ─────────────────────────────────────────
  async getCategoryTree() {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, name, slug, parent_id, icon_url, display_order, is_active')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      logger.error({ error }, 'getCategoryTree failed');
      throw error;
    }

    if (!data || data.length === 0) {
      logger.warn('No categories found in database — run category seeds');
      return [];
    }

    return this._buildTree(data);
  }

  // ─────────────────────────────────────────
  // Get all categories flat
  // ─────────────────────────────────────────
  async getAllCategoriesFlat() {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, name, slug, parent_id, icon_url, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      logger.error({ error }, 'getAllCategoriesFlat failed');
      throw error;
    }

    return data || [];
  }

  // ─────────────────────────────────────────
  // Find by slug
  // ─────────────────────────────────────────
  async findCategoryBySlug(slug) {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, name, slug, parent_id, icon_url, display_order, is_active')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      logger.error({ error }, 'findCategoryBySlug failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Find by ID
  // ─────────────────────────────────────────
  async findCategoryById(id) {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, name, slug, parent_id, display_order, is_active')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      logger.error({ error }, 'findCategoryById failed');
      throw error;
    }

    return data || null;
  }

  // ─────────────────────────────────────────
  // Create category
  // ─────────────────────────────────────────
  async createCategory(data) {
    const { data: category, error } = await this.supabase
      .from('categories')
      .insert(data)
      .select('id, name, slug, parent_id, icon_url, display_order, is_active')
      .single();

    if (error) {
      logger.error({ error }, 'createCategory failed');
      throw error;
    }

    return category;
  }

  // ─────────────────────────────────────────
  // Update category
  // ─────────────────────────────────────────
  async updateCategory(categoryId, updates) {
    const { data, error } = await this.supabase
      .from('categories')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', categoryId)
      .select('id, name, slug, parent_id, icon_url, display_order, is_active')
      .single();

    if (error) {
      logger.error({ error }, 'updateCategory failed');
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────
  // Deactivate category
  // ─────────────────────────────────────────
  async deactivateCategory(categoryId) {
    const { error } = await this.supabase
      .from('categories')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', categoryId);

    if (error) {
      logger.error({ error }, 'deactivateCategory failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Build tree from flat list
  // ─────────────────────────────────────────
  _buildTree(categories) {
    const map = {};
    const roots = [];

    // First pass: create map
    categories.forEach((cat) => {
      map[cat.id] = { ...cat, children: [] };
    });

    // Second pass: build tree
    categories.forEach((cat) => {
      if (cat.parent_id && map[cat.parent_id]) {
        map[cat.parent_id].children.push(map[cat.id]);
      } else if (!cat.parent_id) {
        roots.push(map[cat.id]);
      }
    });

    return roots;
  }
}

module.exports = CategoryRepository;