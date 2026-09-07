# ALIWAYZ MOBILE API GATEWAY ARCHITECTURE & SECURITY DIRECTIVES

## 1. Single Entry-Point API Gateway Pattern
All mobile client communication (Flutter iOS & Android) MUST route strictly through the Node.js Fastify API Gateway (`/api/v1/*`).

```
┌────────────────────────────────┐
│      Flutter Mobile App        │
│    (Android & iOS Clients)     │
└───────────────┬────────────────┘
                │
                │ HTTPS REST & WebSockets (Socket.IO)
                ▼
┌────────────────────────────────┐
│   Fastify API Gateway (Node)   │
│ - JWT Authentication & RBAC    │
│ - Request Sanitization & Ajv   │
│ - Rate Limiting & OWASP        │
│ - Redis Cache & Event Gateway  │
└───────────────┬────────────────┘
                │
                │ Internal Service-Role Protocol
                ▼
┌────────────────────────────────┐
│   Supabase Cloud Platform      │
│ - PostgreSQL DB                │
│ - Supabase Storage Buckets     │
└────────────────────────────────┘
```

## 2. Strict Security Mandates for Mobile Clients
1. **NO Direct Supabase Database Access:** Mobile clients must NEVER query Supabase PostgreSQL directly using `@supabase/supabase-js` or `supabase_flutter` with the anon key for application data.
2. **NO Direct Supabase Storage Uploads:** Mobile upload streams MUST either use Fastify Multipart API endpoints (`POST /api/v1/products/:id/images`) OR request server-generated Presigned Upload URLs (`POST /api/v1/products/:id/images/presigned-urls`).
3. **JWT Token Usage:** Fastify issues custom HMAC-SHA256 JWT tokens. Pass `Authorization: Bearer <access_token>` in all authenticated HTTP headers and Socket.IO handshake auth objects (`socket.handshake.auth.token` or `socket.handshake.query.token`).

## 3. Server-Side Service Role Isolation
The Supabase `SERVICE_ROLE_KEY` is isolated strictly within Node.js process environment variables and used ONLY for:
- Server-side administrative operations
- Background cron jobs and queue workers
- API Gateway data aggregation and database writes
- Generating presigned object storage URLs
