'use strict';

const logger = require('../../shared/utils/logger');

class WantedRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  get _baseSelect() {
    return `
      id,
      buyer_id,
      category,
      title,
      intent,
      item_type,
      description,
      budget_min,
      budget_max,
      currency,
      location_city,
      location_lat,
      location_lng,
      location_radius,
      preferred_areas,
      features,
      bedrooms,
      bathrooms,
      property_size,
      parking_important,
      duration_days,
      expires_at,
      metadata,
      status,
      created_at,
      updated_at,
      users:buyer_id (
        id,
        username,
        full_name,
        avatar_url,
        location_city
      )
    `;
  }

  async createWantedRequest(data) {
    const { data: request, error } = await this.supabase
      .from('wanted_requests')
      .insert(data)
      .select(this._baseSelect)
      .single();

    if (error) {
      logger.error({ error }, 'createWantedRequest failed');
      throw error;
    }
    return request;
  }

  async findWantedRequests({
    category,
    intent,
    minPrice,
    maxPrice,
    city,
    status = 'active',
    search,
    limit = 20,
    offset = 0,
    sort = 'newest',
  }) {
    let query = this.supabase
      .from('wanted_requests')
      .select(`
        ${this._baseSelect},
        wanted_matches (
          id,
          seller_id,
          product_id,
          message,
          status,
          created_at,
          products (
            id,
            title,
            price,
            currency,
            location_city,
            product_images (
              cdn_url,
              storage_url,
              is_primary
            )
          ),
          users:seller_id (
            id,
            username,
            full_name,
            avatar_url
          )
        )
      `, { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    if (category && category !== 'all' && category !== 'All') {
      const normalizedCat = category.toLowerCase().replace(/\s+/g, '_');
      query = query.eq('category', normalizedCat);
    }

    if (intent && intent !== 'all') {
      query = query.eq('intent', intent.toLowerCase());
    }

    if (city) {
      query = query.ilike('location_city', `%${city}%`);
    }

    if (minPrice !== undefined && minPrice > 0) {
      query = query.gte('budget_max', minPrice);
    }

    if (maxPrice !== undefined && maxPrice > 0) {
      query = query.lte('budget_min', maxPrice);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,location_city.ilike.%${search}%`);
    }

    if (sort === 'budget_high') {
      query = query.order('budget_max', { ascending: false });
    } else if (sort === 'budget_low') {
      query = query.order('budget_min', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) {
      logger.error({ error }, 'findWantedRequests failed');
      throw error;
    }

    return { data: data || [], total: count || 0 };
  }

  async findUserRequests(userId, status) {
    let query = this.supabase
      .from('wanted_requests')
      .select(`
        ${this._baseSelect},
        wanted_matches (
          id,
          seller_id,
          product_id,
          message,
          status,
          created_at,
          products (
            id,
            title,
            price,
            currency,
            location_city,
            product_images (
              cdn_url,
              storage_url,
              is_primary
            )
          ),
          users:seller_id (
            id,
            username,
            full_name,
            avatar_url
          )
        )
      `)
      .eq('buyer_id', userId);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      logger.error({ error }, 'findUserRequests failed');
      throw error;
    }
    return data || [];
  }

  async findRequestById(id) {
    const { data, error } = await this.supabase
      .from('wanted_requests')
      .select(`
        ${this._baseSelect},
        wanted_matches (
          id,
          seller_id,
          product_id,
          message,
          status,
          created_at,
          products (
            id,
            title,
            price,
            currency,
            location_city,
            product_images (
              cdn_url,
              storage_url,
              is_primary
            )
          ),
          users:seller_id (
            id,
            username,
            full_name,
            avatar_url
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      logger.error({ error }, 'findRequestById failed');
      throw error;
    }
    return data;
  }

  async updateStatus(id, buyerId, status) {
    const { data, error } = await this.supabase
      .from('wanted_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('buyer_id', buyerId)
      .select(this._baseSelect)
      .single();

    if (error) {
      logger.error({ error }, 'updateStatus failed');
      throw error;
    }
    return data;
  }

  async createMatch({ wanted_request_id, seller_id, product_id, message }) {
    const { data, error } = await this.supabase
      .from('wanted_matches')
      .insert({
        wanted_request_id,
        seller_id,
        product_id: product_id || null,
        message: message || '',
        status: 'pending',
      })
      .select(`
        id,
        wanted_request_id,
        seller_id,
        product_id,
        message,
        status,
        created_at,
        products (
          id,
          title,
          price,
          currency,
          location_city,
          product_images (
            cdn_url,
            storage_url,
            is_primary
          )
        ),
        users:seller_id (
          id,
          username,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (error) {
      logger.error({ error }, 'createMatch failed');
      throw error;
    }
    return data;
  }
}

module.exports = WantedRepository;
