'use strict';

const logger = require('../../shared/utils/logger');

// Haversine distance formula (km)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

class ProductRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  get _baseSelect() {
    return `
      id,
      title,
      slug,
      description,
      price,
      currency,
      condition,
      brand,
      color,
      quantity,
      status,
      location_city,
      location_lat,
      location_lng,
      view_count,
      favorite_count,
      is_featured,
      created_at,
      updated_at,
      categories (
        id,
        name,
        slug
      ),
      product_images (
        id,
        cdn_url,
        storage_url,
        thumbnail_cdn_url,
        thumbnail_storage_url,
        display_order,
        is_primary
      ),
      stores (
        id,
        store_name,
        slug,
        logo_url,
        is_verified,
        average_rating
      ),
      users:seller_id (
        id,
        username,
        avatar_url,
        location_city
      )
    `;
  }

  get _listSelect() {
    return `
      id,
      title,
      slug,
      price,
      currency,
      condition,
      status,
      location_city,
      location_lat,
      location_lng,
      view_count,
      favorite_count,
      created_at,
      product_images (
        cdn_url,
        storage_url,
        thumbnail_cdn_url,
        thumbnail_storage_url,
        is_primary
      ),
      stores (
        id,
        store_name,
        slug,
        logo_url,
        is_verified
      )
    `;
  }

  async createProduct(productData) {
    const { data, error } = await this.supabase
      .from('products')
      .insert(productData)
      .select(this._baseSelect)
      .single();

    if (error) {
      logger.error({ error }, 'createProduct failed');
      throw error;
    }
    return data;
  }

  async findProductById(productId, includeDeleted = false) {
    let query = this.supabase
      .from('products')
      .select(this._baseSelect)
      .eq('id', productId);

    if (!includeDeleted) query = query.eq('is_deleted', false);

    const { data, error } = await query.single();
    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findProductById failed');
      throw error;
    }
    return data || null;
  }

  async findProductBySlug(slug) {
    const { data, error } = await this.supabase
      .from('products')
      .select(this._baseSelect)
      .eq('slug', slug)
      .eq('is_deleted', false)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error }, 'findProductBySlug failed');
      throw error;
    }
    return data || null;
  }

  async updateProduct(productId, updates) {
    const { data, error } = await this.supabase
      .from('products')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', productId)
      .select(this._baseSelect)
      .single();

    if (error) {
      logger.error({ error }, 'updateProduct failed');
      throw error;
    }
    return data;
  }

  async softDeleteProduct(productId) {
    const { error } = await this.supabase
      .from('products')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        status:     'hidden',
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId);

    if (error) {
      logger.error({ error }, 'softDeleteProduct failed');
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // BROWSE PRODUCTS — with optional geo filter
  // ─────────────────────────────────────────
  async browseProducts({
    limit,
    offset,
    categoryId,
    minPrice,
    maxPrice,
    condition,
    sort,
    city,
    status = 'available',
    lat,
    lng,
    radiusKm,
  }) {
    // If location params provided, use geo filtering
    if (lat && lng && radiusKm && parseFloat(radiusKm) < 15000) {
      return this._browseNearbyProducts({
        limit, offset, categoryId, minPrice, maxPrice,
        condition, sort, city, status, lat, lng, radiusKm,
      });
    }

    // Standard browse without location
    let query = this.supabase
      .from('products')
      .select(this._listSelect, { count: 'exact' })
      .eq('status', status)
      .eq('is_deleted', false);

    if (categoryId)            query = query.eq('category_id', categoryId);
    if (minPrice !== undefined) query = query.gte('price', minPrice);
    if (maxPrice !== undefined) query = query.lte('price', maxPrice);
    if (condition)             query = query.eq('condition', condition);
    if (city)                  query = query.ilike('location_city', `%${city}%`);

    switch (sort) {
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'price_asc':
        query = query.order('price', { ascending: true });
        break;
      case 'price_desc':
        query = query.order('price', { ascending: false });
        break;
      case 'popular':
        query = query.order('view_count', { ascending: false });
        break;
      case 'newest':
      default:
        query = query.order('created_at', { ascending: false });
        break;
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error({ error }, 'browseProducts failed');
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  // ─────────────────────────────────────────
  // NEARBY PRODUCTS — geo filtered
  // ─────────────────────────────────────────
  async _browseNearbyProducts({
    limit, offset, categoryId, minPrice, maxPrice,
    condition, sort, city, status, lat, lng, radiusKm,
  }) {
    // Try database RPC first
    try {
      const { data, error } = await this.supabase.rpc(
        'browse_products_nearby',
        {
          p_lat:         parseFloat(lat),
          p_lng:         parseFloat(lng),
          p_radius_km:   parseFloat(radiusKm),
          p_category_id: categoryId || null,
          p_min_price:   minPrice ? parseFloat(minPrice) : null,
          p_max_price:   maxPrice ? parseFloat(maxPrice) : null,
          p_condition:   condition || null,
          p_status:      status || 'available',
          p_sort:        sort || 'newest',
          p_limit:       parseInt(limit),
          p_offset:      parseInt(offset),
        }
      );

      if (!error && data) {
        // RPC succeeded — get images for each product
        const productIds = data.map((p) => p.id);

        if (productIds.length > 0) {
          // Fetch images
          const { data: images } = await this.supabase
            .from('product_images')
            .select('product_id, cdn_url, storage_url, thumbnail_cdn_url, thumbnail_storage_url, is_primary')
            .in('product_id', productIds);

          // Fetch stores
          const { data: storeProducts } = await this.supabase
            .from('products')
            .select('id, stores(id, store_name, slug, logo_url, is_verified)')
            .in('id', productIds);

          // Merge images and stores into products
          const enriched = data.map((product) => ({
            ...product,
            product_images: (images || []).filter(
              (img) => img.product_id === product.id
            ),
            stores: storeProducts?.find(
              (sp) => sp.id === product.id
            )?.stores || null,
          }));

          return { data: enriched, count: enriched.length };
        }

        return { data: [], count: 0 };
      }
    } catch (rpcError) {
      logger.warn(
        { rpcError: rpcError.message },
        'browse_products_nearby RPC failed — using fallback'
      );
    }

    // Fallback: client-side distance filtering
    return this._fallbackNearbyFilter({
      limit, offset, categoryId, minPrice, maxPrice,
      condition, sort, city, status, lat, lng, radiusKm,
    });
  }

  // ─────────────────────────────────────────
  // FALLBACK: Fetch all then filter by distance
  // ─────────────────────────────────────────
  async _fallbackNearbyFilter({
    limit, offset, categoryId, minPrice, maxPrice,
    condition, sort, city, status, lat, lng, radiusKm,
  }) {
    let query = this.supabase
      .from('products')
      .select(this._listSelect)
      .eq('status', status)
      .eq('is_deleted', false)
      .not('location_lat', 'is', null)
      .not('location_lng', 'is', null);

    if (categoryId)            query = query.eq('category_id', categoryId);
    if (minPrice !== undefined) query = query.gte('price', minPrice);
    if (maxPrice !== undefined) query = query.lte('price', maxPrice);
    if (condition)             query = query.eq('condition', condition);

    query = query.order('created_at', { ascending: false }).limit(500);

    const { data, error } = await query;

    if (error) {
      logger.error({ error }, '_fallbackNearbyFilter failed');
      throw error;
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxDist = parseFloat(radiusKm);

    const filtered = (data || [])
      .map((product) => {
        if (!product.location_lat || !product.location_lng) return null;

        const dist = haversineDistance(
          userLat,
          userLng,
          parseFloat(product.location_lat),
          parseFloat(product.location_lng)
        );

        if (dist > maxDist) return null;

        return {
          ...product,
          distance_km: Math.round(dist * 100) / 100,
        };
      })
      .filter(Boolean);

    // Sort
    switch (sort) {
      case 'nearest':
        filtered.sort((a, b) => a.distance_km - b.distance_km);
        break;
      case 'price_asc':
        filtered.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        filtered.sort((a, b) => b.price - a.price);
        break;
      case 'popular':
        filtered.sort((a, b) => b.view_count - a.view_count);
        break;
      case 'oldest':
        filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        break;
      default:
        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    const paginated = filtered.slice(offset, offset + limit);

    return {
      data:  paginated,
      count: filtered.length,
    };
  }

  // ─────────────────────────────────────────
  // Remaining methods stay exactly the same
  // ─────────────────────────────────────────
  async getTrendingProducts(limit = 20) {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('products')
      .select(this._listSelect)
      .eq('status', 'available')
      .eq('is_deleted', false)
      .gte('updated_at', twoDaysAgo)
      .order('view_count', { ascending: false })
      .order('favorite_count', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error }, 'getTrendingProducts failed');
      throw error;
    }
    return data || [];
  }

  async getRecentProducts(limit = 20, offset = 0) {
    const { data, error, count } = await this.supabase
      .from('products')
      .select(this._listSelect, { count: 'exact' })
      .eq('status', 'available')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error }, 'getRecentProducts failed');
      throw error;
    }
    return { data: data || [], count: count || 0 };
  }

  async getNearbyProducts(lat, lng, radiusKm, limit = 20) {
    const { data, error } = await this.supabase.rpc('get_nearby_products', {
      p_lat:       lat,
      p_lng:       lng,
      p_radius_km: radiusKm,
      p_limit:     limit,
    });

    if (error) {
      logger.error({ error }, 'getNearbyProducts failed');
      throw error;
    }
    return data || [];
  }

  async getRecommendedProducts(userId, limit = 20) {
    const { data, error } = await this.supabase.rpc('get_recommended_products', {
      p_user_id: userId,
      p_limit:   limit,
    });

    if (error) {
      logger.error({ error }, 'getRecommendedProducts failed');
      const fallback = await this.getRecentProducts(limit);
      return fallback.data;
    }
    return data || [];
  }

  async recordView(productId, viewerId, ipAddress, userAgent) {
    const { error } = await this.supabase
      .from('product_views')
      .insert({
        product_id: productId,
        viewer_id:  viewerId || null,
        ip_address: ipAddress,
        user_agent: userAgent,
      });

    if (error) {
      logger.warn({ error }, 'recordView insert failed');
      return;
    }

    await this.supabase.rpc('increment_product_view_count', {
      product_id: productId,
    });
  }

  async addProductImage(productId, imageData) {
    const { data, error } = await this.supabase
      .from('product_images')
      .insert({ product_id: productId, ...imageData })
      .select('id, cdn_url, storage_url, thumbnail_cdn_url, thumbnail_storage_url, display_order, is_primary')
      .single();

    if (error) {
      logger.error({ error }, 'addProductImage failed');
      throw error;
    }
    return data;
  }

  async countProductImages(productId) {
    const { count, error } = await this.supabase
      .from('product_images')
      .select('*', { count: 'exact', head: true })
      .eq('product_id', productId);

    if (error) throw error;
    return count || 0;
  }

  async findProductImage(imageId, productId) {
    const { data, error } = await this.supabase
      .from('product_images')
      .select('id, storage_url, cdn_url, thumbnail_storage_url, thumbnail_cdn_url, is_primary, product_id')
      .eq('id', imageId)
      .eq('product_id', productId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  async deleteProductImage(imageId) {
    const { error } = await this.supabase
      .from('product_images')
      .delete()
      .eq('id', imageId);

    if (error) {
      logger.error({ error }, 'deleteProductImage failed');
      throw error;
    }
  }

  async addProductVideo(productId, videoData) {
    await this.supabase
      .from('product_videos')
      .delete()
      .eq('product_id', productId);

    const { data, error } = await this.supabase
      .from('product_videos')
      .insert({ product_id: productId, ...videoData })
      .select('id, cdn_url, storage_url, thumbnail_url')
      .single();

    if (error) {
      logger.error({ error }, 'addProductVideo failed');
      throw error;
    }
    return data;
  }

  async isProductFavorited(userId, productId) {
    const { data, error } = await this.supabase
      .from('favorites')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }

  async addFavorite(userId, productId) {
    const { error } = await this.supabase
      .from('favorites')
      .insert({ user_id: userId, product_id: productId });

    if (error && error.code !== '23505') {
      logger.error({ error }, 'addFavorite failed');
      throw error;
    }

    await this.supabase.rpc('increment_product_favorite_count', {
      product_id: productId,
    });
  }

  async removeFavorite(userId, productId) {
    const { error } = await this.supabase
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);

    if (error) {
      logger.error({ error }, 'removeFavorite failed');
      throw error;
    }

    await this.supabase.rpc('decrement_product_favorite_count', {
      product_id: productId,
    });
  }

  async getProductFavoriters(productId) {
    const { data, error } = await this.supabase
      .from('favorites')
      .select('users:user_id(id, fcm_token)')
      .eq('product_id', productId);

    if (error) {
      logger.error({ error }, 'getProductFavoriters failed');
      throw error;
    }

    return data?.map((f) => f.users).filter(Boolean) || [];
  }

  async refreshSellerStats(sellerId) {
    await this.supabase.rpc('refresh_seller_listing_stats', {
      p_seller_id: sellerId,
    });
  }

  async getFeaturedProducts(limit = 10) {
    const { data, error } = await this.supabase
      .from('products')
      .select(this._listSelect)
      .eq('is_featured', true)
      .eq('status', 'available')
      .eq('is_deleted', false)
      .gt('featured_until', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error }, 'getFeaturedProducts failed');
      throw error;
    }
    return data || [];
  }
}

module.exports = ProductRepository;