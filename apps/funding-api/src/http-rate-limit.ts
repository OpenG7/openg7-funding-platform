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
}

const RATE_LIMIT_BUCKET_PRUNE_THRESHOLD = 5000;

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
    buckets: new Map<string, RateLimitBucket>()
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
    for (const [key, bucket] of limiter.buckets) {
      if (bucket.resetAt <= now) {
        limiter.buckets.delete(key);
      }
    }
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
      limiter.buckets.set(key, {
        count: 1,
        resetAt: now + limiter.windowMs
      });
      return true;
    }

    if (bucket.count >= limiter.maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.resetAt - now) / 1000)
      );
      writeJson(
        request,
        response,
        429,
        { error: 'Too many requests. Please retry later.' },
        { 'Retry-After': String(retryAfterSeconds) }
      );
      return false;
    }

    bucket.count += 1;

    if (limiter.buckets.size > RATE_LIMIT_BUCKET_PRUNE_THRESHOLD) {
      pruneExpiredRateLimitBuckets(limiter, now);
    }

    return true;
  };

  const getRequestRateLimiter = (request: ApiRequest): RateLimiter | null => {
    if (
      routeStartsWith(request.url, '/admin/auth/', '/api/admin/auth/') ||
      routeMatches(request.url, '/admin/access', '/api/admin/access')
    ) {
      return adminRateLimiter;
    }
    if (
      request.method === 'POST' &&
      routeMatches(request.url, '/checkout-sessions', '/api/checkout-sessions')
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

    if (
      routeMatches(
        request.url,
        '/admin/pilotage',
        '/api/admin/pilotage',
        '/admin/pilotage/programme',
        '/api/admin/pilotage/programme',
        '/admin/pilotage/variant',
        '/api/admin/pilotage/variant',
        '/admin/pilotage/command',
        '/api/admin/pilotage/command',
        '/admin/pilotage/receipt',
        '/api/admin/pilotage/receipt',
        '/admin/session',
        '/api/admin/session',
        '/admin/setup-status',
        '/api/admin/setup-status',
        '/admin/email/test',
        '/api/admin/email/test',
        '/admin/email-queue',
        '/api/admin/email-queue',
        '/admin/email-queue/retry',
        '/api/admin/email-queue/retry',
        '/admin/sponsorship-invoices',
        '/api/admin/sponsorship-invoices',
        '/admin/sponsorship-invoices/backfill',
        '/api/admin/sponsorship-invoices/backfill',
        '/admin/sponsorship-invoices/pdf',
        '/api/admin/sponsorship-invoices/pdf',
        '/admin/sponsorship-invoices/resend',
        '/api/admin/sponsorship-invoices/resend',
        '/admin/sponsorship-credit-notes/pdf',
        '/api/admin/sponsorship-credit-notes/pdf',
        '/admin/sponsorship-credit-notes/resend',
        '/api/admin/sponsorship-credit-notes/resend',
        '/admin/dashboard',
        '/api/admin/dashboard',
        '/admin/cockpit/metrics',
        '/api/admin/cockpit/metrics',
        '/admin/cockpit/activity',
        '/api/admin/cockpit/activity',
        '/admin/cockpit/systems',
        '/api/admin/cockpit/systems',
        '/admin/attention',
        '/api/admin/attention',
        '/admin/search',
        '/api/admin/search',
        '/admin/stripe-event',
        '/api/admin/stripe-event',
        '/admin/stripe-backfill',
        '/api/admin/stripe-backfill',
        '/admin/assistant/summary',
        '/api/admin/assistant/summary',
        '/admin/assistant/query',
        '/api/admin/assistant/query',
        '/admin/assistant/prepare',
        '/api/admin/assistant/prepare',
        '/admin/assistant/context',
        '/api/admin/assistant/context',
        '/admin/sponsorships/progress',
        '/api/admin/sponsorships/progress',
        '/admin/sponsorships/request-information',
        '/api/admin/sponsorships/request-information',
        '/admin/sponsorships/followup-access',
        '/api/admin/sponsorships/followup-access',
        '/admin/contributions',
        '/api/admin/contributions',
        '/admin/contributions.csv',
        '/api/admin/contributions.csv',
        '/admin/expenses',
        '/api/admin/expenses',
        '/admin/expenses/update',
        '/api/admin/expenses/update',
        '/admin/transparency',
        '/api/admin/transparency',
        '/admin/publication-automation',
        '/api/admin/publication-automation',
        '/admin/publication-automation/media',
        '/api/admin/publication-automation/media',
        '/admin/publication-drafts',
        '/api/admin/publication-drafts',
        '/admin/publication-drafts/update',
        '/api/admin/publication-drafts/update',
        '/admin/publication-batches',
        '/api/admin/publication-batches',
        '/admin/publication-batches/assign',
        '/api/admin/publication-batches/assign',
        '/admin/publication-batches/unassign',
        '/api/admin/publication-batches/unassign',
        '/admin/publication-batches/schedule',
        '/api/admin/publication-batches/schedule',
        '/admin/publication-batches/publish',
        '/api/admin/publication-batches/publish',
        '/admin/publication-batches/publish-social',
        '/api/admin/publication-batches/publish-social',
        '/admin/publication-batches/cancel',
        '/api/admin/publication-batches/cancel',
        '/admin/publication-slots',
        '/api/admin/publication-slots',
        '/admin/publication-slots/update',
        '/api/admin/publication-slots/update',
        '/admin/publication-slots/assign-batch',
        '/api/admin/publication-slots/assign-batch',
        '/admin/publication-slots/assign-draft',
        '/api/admin/publication-slots/assign-draft',
        '/admin/publication-slots/publish',
        '/api/admin/publication-slots/publish',
        '/admin/publication-slots/cancel',
        '/api/admin/publication-slots/cancel',
        '/admin/social-publication-jobs',
        '/api/admin/social-publication-jobs',
        '/admin/audit-log',
        '/api/admin/audit-log',
        '/admin/sponsorships',
        '/api/admin/sponsorships',
        '/admin/sponsorships/logo',
        '/api/admin/sponsorships/logo',
        '/admin/sponsorships/logo/delete',
        '/api/admin/sponsorships/logo/delete',
        '/admin/sponsorships/media',
        '/api/admin/sponsorships/media',
        '/admin/sponsorships/media/review',
        '/api/admin/sponsorships/media/review',
        '/admin/sponsorships/media/delete',
        '/api/admin/sponsorships/media/delete',
        '/admin/sponsorships/review',
        '/api/admin/sponsorships/review',
        '/admin/sponsorships/details',
        '/api/admin/sponsorships/details',
        '/admin/sponsorships/interventions',
        '/api/admin/sponsorships/interventions',
        '/admin/sponsorships/refund',
        '/api/admin/sponsorships/refund',
        '/admin/sponsorships/publication',
        '/api/admin/sponsorships/publication'
      ) ||
      routeStartsWith(
        request.url,
        '/admin/sponsorships/media/content/',
        '/api/admin/sponsorships/media/content/'
      )
    ) {
      return adminRateLimiter;
    }

    return null;
  };

  return (request: ApiRequest, response: ApiResponse): boolean => {
    const limiter = getRequestRateLimiter(request);
    return !limiter || enforceRateLimit(request, response, limiter);
  };
};
