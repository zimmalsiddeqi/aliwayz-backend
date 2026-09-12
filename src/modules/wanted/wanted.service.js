'use strict';

const WantedRepository = require('./wanted.repository');
const { getPaginationParams } = require('../../shared/utils/paginate');
const logger = require('../../shared/utils/logger');
const AppError = require('../../shared/errors/AppError');
const NotFoundError = require('../../shared/errors/NotFoundError');

class WantedService {
  constructor(supabase, redis) {
    this.supabase = supabase;
    this.redis = redis;
    this.repo = new WantedRepository(supabase);
  }

  async createRequest(buyerId, data) {
    const durationDays = data.duration_days || 30;
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const requestPayload = {
      buyer_id: buyerId,
      category: (data.category || 'real_estate').toLowerCase().replace(/\s+/g, '_'),
      title: data.title,
      intent: (data.intent || 'buy').toLowerCase(),
      item_type: data.item_type || null,
      description: data.description || '',
      budget_min: data.budget_min || 0,
      budget_max: data.budget_max || 0,
      currency: data.currency || 'USD',
      location_city: data.location_city || '',
      location_lat: data.location_lat || null,
      location_lng: data.location_lng || null,
      location_radius: data.location_radius || 10,
      preferred_areas: data.preferred_areas || [],
      features: data.features || [],
      bedrooms: data.bedrooms || null,
      bathrooms: data.bathrooms || null,
      property_size: data.property_size || null,
      parking_important: !!data.parking_important,
      duration_days: durationDays,
      expires_at: expiresAt,
      metadata: data.metadata || {},
      status: 'active',
    };

    const newRequest = await this.repo.createWantedRequest(requestPayload);
    logger.info({ requestId: newRequest.id, buyerId }, 'Wanted request created successfully');

    return newRequest;
  }

  async browseRequests(query, currentUser = null) {
    const { limit, offset, page } = getPaginationParams(query);

    const { data, total } = await this.repo.findWantedRequests({
      category: query.category,
      intent: query.intent,
      minPrice: query.minPrice ? parseFloat(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
      city: query.city,
      status: query.status || 'active',
      search: query.search,
      sort: query.sort || 'newest',
      limit,
      offset,
    });

    // All other users' requests are shown in the Wanted feed.
    // If the current logged-in user has role 'both' (or 'seller'), their own requests
    // will not be shown in the public Wanted page (they appear in My Requests).
    let filteredData = data || [];
    if (currentUser?.id && (currentUser.role === 'both' || currentUser.role === 'seller')) {
      filteredData = filteredData.filter(
        (req) => req.buyer_id !== currentUser.id && req.users?.id !== currentUser.id
      );
    }

    const totalPages = Math.ceil(total / limit);

    return {
      data: filteredData,
      pagination: {
        total: filteredData.length,
        page,
        limit,
        totalPages: Math.ceil(filteredData.length / limit) || 1,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async getMyRequests(userId, status) {
    return this.repo.findUserRequests(userId, status);
  }

  async getRequestById(id) {
    const request = await this.repo.findRequestById(id);
    if (!request) {
      throw new NotFoundError('Wanted Request');
    }
    return request;
  }

  async updateStatus(id, userId, status) {
    const request = await this.repo.findRequestById(id);
    if (!request) {
      throw new NotFoundError('Wanted Request');
    }
    const creatorId = request.buyer_id || request.users?.id;
    if (creatorId !== userId) {
      throw new AppError('Unauthorized to update this request', 403);
    }
    return this.repo.updateStatus(id, creatorId, status);
  }

  async submitMatch(sellerId, wantedRequestId, data) {
    const request = await this.repo.findRequestById(wantedRequestId);
    if (!request) {
      throw new NotFoundError('Wanted Request');
    }

    if (request.buyer_id === sellerId) {
      throw new AppError('You cannot fulfill your own wanted request', 400);
    }

    const match = await this.repo.createMatch({
      wanted_request_id: wantedRequestId,
      seller_id: sellerId,
      product_id: data.product_id || null,
      message: data.message || '',
    });

    // Create in-app and push notification for the buyer if inform_buyer is enabled
    if (data.inform_buyer !== false) {
      try {
        const NotificationService = require('../notifications/notification.service');
        const notifService = new NotificationService(this.supabase, this.redis);

        let matchedItemTitle = '';
        if (data.product_id) {
          const { data: prod } = await this.supabase
            .from('products')
            .select('title, price')
            .eq('id', data.product_id)
            .single();
          if (prod?.title) matchedItemTitle = prod.title;
        }

        const noteText = data.message ? ` "${data.message.slice(0, 80)}"` : '';
        const body = matchedItemTitle
          ? `A seller matched your request "${request.title}" with "${matchedItemTitle}".${noteText}`
          : `A seller matched your request "${request.title}".${noteText}`;

        await notifService.createNotification({
          userId: request.buyer_id,
          type: 'wanted_match',
          title: 'New match for your wanted request!',
          body,
          data: {
            wanted_request_id: wantedRequestId,
            match_id: match.id,
            product_id: data.product_id || null,
            seller_id: sellerId,
            route: '/wanted/my-requests',
          },
        });
      } catch (notifErr) {
        logger.warn({ notifErr }, 'Failed to send notification for wanted match');
      }
    }

    logger.info({ sellerId, wantedRequestId, matchId: match.id }, 'Match submitted for wanted request');
    return match;
  }
}

module.exports = WantedService;
