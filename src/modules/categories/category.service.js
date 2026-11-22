'use strict';

const CategoryRepository = require('./category.repository');
const ProductRepository = require('../products/product.repository');

const { createSlug } = require('../../shared/utils/slugify');
const { getPaginationParams } = require('../../shared/utils/paginate');
const { CACHE_KEYS, CACHE_TTL } = require('../../shared/constants/cacheKeys');
const logger = require('../../shared/utils/logger');

const NotFoundError = require('../../shared/errors/NotFoundError');
const AppError = require('../../shared/errors/AppError');

class CategoryService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new CategoryRepository(supabase);
    this.productRepo = new ProductRepository(supabase);
  }

  // ─────────────────────────────────────────
  // GET CATEGORY TREE
  // ─────────────────────────────────────────
  async getCategoryTree() {
    // ✅ FIX: Check cache first — only fetch if missing
    const cached = await this.redis.get(CACHE_KEYS.CATEGORIES_TREE);
    if (cached && cached.length > 0) return cached;

    const tree = await this.repo.getCategoryTree();

    if (tree && tree.length > 0) {
      await this.redis.set(
        CACHE_KEYS.CATEGORIES_TREE,
        tree,
        CACHE_TTL.CATEGORIES_TREE
      );
    }

    return tree;
  }

  // ─────────────────────────────────────────
  // GET FLAT CATEGORIES
  // ─────────────────────────────────────────
  async getAllCategoriesFlat() {
    // ✅ FIX: Check cache first
    const cacheKey = 'categories:flat';
    const cached = await this.redis.get(cacheKey);
    if (cached && cached.length > 0) return cached;

    const categories = await this.repo.getAllCategoriesFlat();

    if (categories && categories.length > 0) {
      await this.redis.set(
        cacheKey,
        categories,
        CACHE_TTL.CATEGORIES_TREE
      );
    }

    return categories;
  }

  // ─────────────────────────────────────────
  // GET CATEGORY WITH PRODUCTS
  // ─────────────────────────────────────────
  async getCategoryWithProducts(slug, query) {
    const category = await this.repo.findCategoryBySlug(slug);
    if (!category) throw new NotFoundError('Category');

    const { page, limit, offset } = getPaginationParams(query);

    // Resolve all subcategories recursively (Levels 1, 2, and 3)
    const allCategories = await this.getAllCategoriesFlat();
    const getDescendants = (parentId) => {
      let ids = [];
      const children = allCategories.filter((c) => c.parent_id === parentId);
      for (const child of children) {
        ids.push(child.id);
        ids = ids.concat(getDescendants(child.id));
      }
      return ids;
    };
    // Auto-heal / promote products sitting in broader ancestor categories
    if (category.parent_id) {
      const getAncestors = (catId) => {
        let ancestors = [];
        let curr = allCategories.find((c) => c.id === catId);
        while (curr && curr.parent_id) {
          ancestors.push(curr.parent_id);
          curr = allCategories.find((c) => c.id === curr.parent_id);
        }
        return ancestors;
      };
      const ancestorIds = getAncestors(category.id);

      if (ancestorIds.length > 0) {
        const catNameClean = (category.name || '').trim().toLowerCase();
        const terms = [category.name];
        if (catNameClean.includes('samsung')) terms.push('Samsung');
        if (catNameClean.includes('iphone')) terms.push('iPhone', 'Apple');
        if (catNameClean.includes('pixel')) terms.push('Pixel');
        if (catNameClean.includes('ipad')) terms.push('iPad');

        for (const term of terms) {
          const { data: looseProducts } = await this.supabase
            .from('products')
            .select('id')
            .in('category_id', ancestorIds)
            .ilike('title', `%${term}%`)
            .eq('is_deleted', false);

          if (looseProducts && looseProducts.length > 0) {
            const looseIds = looseProducts.map((p) => p.id);
            await this.supabase
              .from('products')
              .update({ category_id: category.id })
              .in('id', looseIds);
            logger.info({ categoryId: category.id, looseIds, term }, 'Auto-promoted loose ancestor products to subcategory');
          }
        }
      }
    }

    const categoryIds = [category.id, ...getDescendants(category.id)];

    const { data, count } = await this.productRepo.browseProducts({
      limit,
      offset,
      categoryId: categoryIds,
      minPrice: query.min_price ? parseFloat(query.min_price) : undefined,
      maxPrice: query.max_price ? parseFloat(query.max_price) : undefined,
      condition: query.condition,
      sort: query.sort || 'newest',
      city: query.city || undefined,
      lat: query.lat || undefined,
      lng: query.lng || undefined,
      radiusKm: query.radius_km || undefined,
    });

    return {
      category,
      products: data,
      pagination: { page, limit, total: count },
    };
  }

  // ─────────────────────────────────────────
  // ADMIN: CREATE
  // ─────────────────────────────────────────
  async createCategory(data) {
    // ✅ Use stable slug for categories (no random suffix)
    const { createStableSlug } = require('../../shared/utils/slugify');
    const slug = createStableSlug(data.name);

    const category = await this.repo.createCategory({
      name: data.name,
      slug,
      parent_id: data.parent_id || null,
      icon_url: data.icon_url || null,
      display_order: data.display_order || 0,
      is_active: true,
    });

    await this.redis.del(CACHE_KEYS.CATEGORIES_TREE);
    await this.redis.del('categories:flat');

    return category;
  }

  // ─────────────────────────────────────────
  // ADMIN: UPDATE
  // ─────────────────────────────────────────
  async updateCategory(categoryId, data) {
    const updates = { ...data };
    if (data.name) {
      const { createStableSlug } = require('../../shared/utils/slugify');
      updates.slug = createStableSlug(data.name);
    }

    const category = await this.repo.updateCategory(categoryId, updates);

    await this.redis.del(CACHE_KEYS.CATEGORIES_TREE);
    await this.redis.del('categories:flat');

    return category;
  }

  // ─────────────────────────────────────────
  // ADMIN: DELETE
  // ─────────────────────────────────────────
  async deleteCategory(categoryId) {
    await this.repo.deactivateCategory(categoryId);

    await this.redis.del(CACHE_KEYS.CATEGORIES_TREE);
    await this.redis.del('categories:flat');

    return { message: 'Category deactivated' };
  }
}

module.exports = CategoryService;