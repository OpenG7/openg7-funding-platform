import type { IncomingMessage, ServerResponse } from 'node:http';

import type { createHttpTransport } from './http-transport.js';
import { createRouteMatcher } from './http-routing.js';
import { requestClientIp } from './request-client-ip.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimiter {
  readonly name: string;
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly buckets: Map<string, RateLimitBucket>;
  nextPruneAt: number;
}

const RATE_LIMIT_MAX_BUCKETS = 5000;

export interface RequestRateLimitConfig {
  readonly publicBaseOrigin: string;
  readonly trustedProxyHops: number;
  readonly rateLimitWindowMs: number;
  readonly publicWriteRateLimitMax: number;
  readonly sponsorshipFollowupRateLimitMax: number;
  readonly referenceLookupRateLimitMax: number;
  readonly referenceRecoveryRateLimitMax: number;
  readonly adminRateLimitMax: number;
}

/** One process-local limiter, preserving the existing route groups and HTTP response. */
export const createRequestRateLimit = (
  {
    publicBaseOrigin,
    trustedProxyHops,
    rateLimitWindowMs,
    publicWriteRateLimitMax,
    sponsorshipFollowupRateLimitMax,
    referenceLookupRateLimitMax,
    referenceRecoveryRateLimitMax,
    adminRateLimitMax
  }: RequestRateLimitConfig,
  writeJson: ReturnType<typeof createHttpTransport>['writeJson'],
  clock: () => number = Date.now
) => {
  const { routeMatches, routeStartsWith } =
    createRouteMatcher(publicBaseOrigin);

  const createRateLimiter = (
    name: string,
    maxRequests: number,
    windowMs: number
  ): RateLimiter => ({
    name,
    maxRequests,
    windowMs,
    buckets: new Map<string, RateLimitBucket>(),
    nextPruneAt: 0
  });

  const publicWriteRateLimiter = createRateLimiter(
    'public-write',
    publicWriteRateLimitMax,
    rateLimitWindowMs
  );
  const sponsorshipFollowupRateLimiter = createRateLimiter(
    'sponsorship-followup',
    sponsorshipFollowupRateLimitMax,
    rateLimitWindowMs
  );
  const referenceLookupRateLimiter = createRateLimiter(
    'reference-lookup',
    referenceLookupRateLimitMax,
    rateLimitWindowMs
  );
  const referenceRecoveryRateLimiter = createRateLimiter(
    'reference-recovery',
    referenceRecoveryRateLimitMax,
    rateLimitWindowMs
  );
  const adminRateLimiter = createRateLimiter(
    'admin',
    adminRateLimitMax,
    rateLimitWindowMs
  );

  const getClientIp = (request: ApiRequest): string =>
    requestClientIp(request, trustedProxyHops);

  const pruneExpiredRateLimitBuckets = (
    limiter: RateLimiter,
    now: number
  ): void => {
    limiter.nextPruneAt = now + limiter.windowMs;
    for (const [key, bucket] of limiter.buckets) {
      if (bucket.resetAt <= now) {
        limiter.buckets.delete(key);
      } else {
        limiter.nextPruneAt = Math.min(limiter.nextPruneAt, bucket.resetAt);
      }
    }
  };

  const refuseRateLimit = (
    request: ApiRequest,
    response: ApiResponse,
    resetAt: number,
    now: number
  ): false => {
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
    writeJson(
      request,
      response,
      429,
      { error: 'Too many requests. Please retry later.' },
      { 'Retry-After': String(retryAfterSeconds) }
    );
    return false;
  };

  const enforceRateLimit = (
    request: ApiRequest,
    response: ApiResponse,
    limiter: RateLimiter
  ): boolean => {
    if (limiter.maxRequests === 0) {
      return true;
    }

    const now = clock();
    const key = `${limiter.name}:${getClientIp(request)}`;
    const bucket = limiter.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && limiter.buckets.size >= RATE_LIMIT_MAX_BUCKETS) {
        if (limiter.nextPruneAt <= now)
          pruneExpiredRateLimitBuckets(limiter, now);
        // Preserve active clients' counters instead of evicting them and
        // allowing a rotating client to reset its quota. Bound memory as well.
        if (limiter.buckets.size >= RATE_LIMIT_MAX_BUCKETS)
          return refuseRateLimit(request, response, limiter.nextPruneAt, now);
      }
      limiter.buckets.set(key, {
        count: 1,
        resetAt: now + limiter.windowMs
      });
      return true;
    }

    if (bucket.count >= limiter.maxRequests) {
      return refuseRateLimit(request, response, bucket.resetAt, now);
    }

    bucket.count += 1;

    return true;
  };

  const getRequestRateLimiter = (request: ApiRequest): RateLimiter | null => {
    if (routeStartsWith(request.url, '/admin/', '/api/admin/')) {
      return adminRateLimiter;
    }
    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/checkout-sessions',
        '/api/checkout-sessions',
        '/sponsorship-details',
        '/api/sponsorship-details'
      )
    ) {
      return publicWriteRateLimiter;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/reference-recovery',
        '/api/reference-recovery',
        '/sponsorship-followup/recover',
        '/api/sponsorship-followup/recover'
      )
    ) {
      return referenceRecoveryRateLimiter;
    }

    if (
      routeMatches(
        request.url,
        '/sponsorship-followup',
        '/api/sponsorship-followup',
        '/sponsorship-followup/details',
        '/api/sponsorship-followup/details',
        '/sponsorship-followup/draft',
        '/api/sponsorship-followup/draft',
        '/sponsorship-followup/media',
        '/api/sponsorship-followup/media',
        '/sponsorship-followup/media/delete',
        '/api/sponsorship-followup/media/delete'
      ) ||
      routeStartsWith(
        request.url,
        '/sponsorship-followup/media/content/',
        '/api/sponsorship-followup/media/content/'
      )
    ) {
      return sponsorshipFollowupRateLimiter;
    }

    if (
      request.method === 'POST' &&
      routeMatches(request.url, '/reference-lookup', '/api/reference-lookup')
    ) {
      return referenceLookupRateLimiter;
    }

    return null;
  };

  return (request: ApiRequest, response: ApiResponse): boolean => {
    const limiter = getRequestRateLimiter(request);
    return !limiter || enforceRateLimit(request, response, limiter);
  };
};
