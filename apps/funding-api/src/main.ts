import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import Stripe from 'stripe';
import type {
  AdminSponsorshipPublicationRequest,
  AdminSponsorshipPublicationResult,
  AdminSponsorshipReviewRequest,
  AdminSponsorshipReviewResult,
  AdminSponsorshipsResponse,
  ContributionType,
  CheckoutResult,
  CheckoutRequest,
  RedirectCheckoutResult,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipDetailsRequest,
  SponsorshipDetailsResult,
  SponsorshipFollowupDetailsRequest,
  SponsorshipFollowupResponse,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import { dbPool, hasDatabase } from './database.js';
import {
  allowedSponsorFeedChannels,
  allowedSponsorFeedStatuses,
  allowedSponsorFeedTargets,
  allowedSponsorshipReviewStatuses,
  insertCheckoutSessionRecord,
  getSponsorshipFollowupByTokenHash,
  listPublicSponsorships,
  listAdminSponsorships,
  normalizeContributionType,
  parseMetadataBoolean,
  recordSponsorshipDetailsForContribution,
  recordSponsorshipDetails,
  updateSponsorshipPublication,
  updateSponsorshipReview
} from './fund-contributions.repository.js';
import { getPublicTransparencySummary } from './fund-transparency.repository.js';
import { getStripePublicTransparencySummary } from './stripe-transparency.service.js';
import { processStripeWebhook } from './stripe-webhook.service.js';

const parsePositiveIntegerEnv = (
  value: string | undefined,
  fallback: number
): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeIntegerEnv = (
  value: string | undefined,
  fallback: number
): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const port = Number(process.env.FUNDING_API_PORT ?? 3333);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const projectId = process.env.FUNDING_PROJECT_ID ?? 'openg7';
const isProduction = process.env.FUNDING_PLATFORM_ENV === 'production';
const adminToken = process.env.FUNDING_ADMIN_TOKEN?.trim() ?? '';
const sponsorshipFollowupTokenTtlDays = parsePositiveIntegerEnv(
  process.env.FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS,
  30
);
const rateLimitWindowMs = parsePositiveIntegerEnv(
  process.env.FUNDING_RATE_LIMIT_WINDOW_MS,
  60_000
);
const publicWriteRateLimitMax = parseNonNegativeIntegerEnv(
  process.env.FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX,
  60
);
const sponsorshipFollowupRateLimitMax = parseNonNegativeIntegerEnv(
  process.env.FUNDING_SPONSORSHIP_FOLLOWUP_RATE_LIMIT_MAX,
  60
);
const adminRateLimitMax = parseNonNegativeIntegerEnv(
  process.env.FUNDING_ADMIN_RATE_LIMIT_MAX,
  120
);
const allowedOrigins = (process.env.FUNDING_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const publicBaseUrl =
  process.env.FUNDING_PUBLIC_BASE_URL ??
  allowedOrigins[0] ??
  (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : null);
const publicBaseOrigin = publicBaseUrl
  ? new URL(publicBaseUrl).origin
  : 'https://example.org';
const allowedReturnHostnames = new Set(
  [publicBaseUrl, ...allowedOrigins]
    .filter(Boolean)
    .map((origin) => new URL(origin).hostname)
);
const allowedContributionAmounts = new Set(
  (process.env.FUNDING_ALLOWED_AMOUNTS ?? '5,10,25,50')
    .split(',')
    .map((amount) => Number(amount.trim()))
    .filter((amount) => Number.isFinite(amount) && amount > 0)
);
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const allowedContributionTypes = new Set<ContributionType>([
  'personal_support',
  'sponsorship_interest'
]);

if (isProduction && !stripeSecretKey) {
  throw new Error(
    'STRIPE_SECRET_KEY is required when FUNDING_PLATFORM_ENV=production.'
  );
}

if (isProduction && !publicBaseUrl) {
  throw new Error(
    'FUNDING_PUBLIC_BASE_URL or FUNDING_ALLOWED_ORIGINS is required in production.'
  );
}

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

const securityHeaders: Record<string, string> = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

const writeJson = (
  request: ApiRequest,
  response: ApiResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {}
): void => {
  response.writeHead(statusCode, {
    ...createCorsHeaders(request),
    ...securityHeaders,
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
};

const writeText = (
  request: ApiRequest,
  response: ApiResponse,
  statusCode: number,
  payload: string
): void => {
  response.writeHead(statusCode, {
    ...createCorsHeaders(request),
    ...securityHeaders,
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(payload);
};

const resolveAllowedOrigin = (request: ApiRequest): string | null => {
  const origin = request.headers.origin;

  if (!isProduction) {
    return '*';
  }

  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    return origin;
  }

  return null;
};

const createCorsHeaders = (request: ApiRequest): Record<string, string> => {
  const allowedOrigin = resolveAllowedOrigin(request);
  const headers: Record<string, string> = {
    Vary: 'Origin'
  };

  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  return headers;
};

const readBody = async (
  request: ApiRequest,
  maxBytes = 256 * 1024
): Promise<string> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error('Request body is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const normalizeAmount = (amount: number): number =>
  Number(Number(amount).toFixed(2));

const isAllowedContributionType = (
  contributionType: unknown
): contributionType is ContributionType =>
  typeof contributionType === 'string' &&
  allowedContributionTypes.has(contributionType as ContributionType);

const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

const SPONSOR_TEXT_MAX_LENGTH = 200;
const SPONSOR_MESSAGE_MAX_LENGTH = 1000;
const SPONSOR_URL_MAX_LENGTH = 2048;
const STRIPE_METADATA_VALUE_MAX_LENGTH = 480;
const PUBLIC_DISPLAY_NAME_MAX_LENGTH = 100;
const ADMIN_REVIEW_NOTE_MAX_LENGTH = 1000;
const SPONSOR_PUBLIC_SLUG_MAX_LENGTH = 120;
const SPONSOR_PUBLIC_SUMMARY_MAX_LENGTH = 500;
const SPONSOR_FEED_NOTES_MAX_LENGTH = 1000;
const FOLLOWUP_TOKEN_BYTES = 32;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const RATE_LIMIT_BUCKET_PRUNE_THRESHOLD = 5000;
const followupEditablePaymentStatuses = new Set(['paid', 'refunded', 'disputed']);

const isNonEmptySponsorText = (
  value: unknown,
  maxLength: number
): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= maxLength;

const isValidSponsorEmail = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length <= SPONSOR_TEXT_MAX_LENGTH &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const isValidOptionalHttpsUrl = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  if (typeof value !== 'string' || value.length > SPONSOR_URL_MAX_LENGTH) {
    return false;
  }

  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const truncateStripeMetadataValue = (value: string): string =>
  value.slice(0, STRIPE_METADATA_VALUE_MAX_LENGTH);

const isValidOptionalBoundedText = (
  value: unknown,
  maxLength: number
): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim().length <= maxLength);

const isValidOptionalPublicSlug = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'string' &&
    value.trim().length <= SPONSOR_PUBLIC_SLUG_MAX_LENGTH &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim()));

const createSponsorshipFollowupToken = (): string =>
  randomBytes(FOLLOWUP_TOKEN_BYTES).toString('base64url');

const hashSponsorshipFollowupToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

const getSponsorshipFollowupTokenCutoffIso = (): string =>
  new Date(
    Date.now() - sponsorshipFollowupTokenTtlDays * MILLISECONDS_PER_DAY
  ).toISOString();

const isValidFollowupToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);

const appendQueryParam = (url: string, key: string, value: string): string =>
  `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;

const isAllowedSponsorshipReviewStatus = (
  value: unknown
): value is SponsorshipReviewStatus =>
  typeof value === 'string' &&
  allowedSponsorshipReviewStatuses.has(value as SponsorshipReviewStatus);

const isAllowedSponsorFeedTarget = (
  value: unknown
): value is SponsorFeedTarget | null =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'string' &&
    allowedSponsorFeedTargets.has(value as SponsorFeedTarget));

const isAllowedSponsorFeedStatus = (
  value: unknown
): value is SponsorFeedStatus =>
  typeof value === 'string' &&
  allowedSponsorFeedStatuses.has(value as SponsorFeedStatus);

const parseSponsorFeedChannelsFromRequest = (
  value: unknown
): readonly SponsorFeedChannel[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const uniqueChannels = [...new Set(value)];
  if (
    uniqueChannels.some(
      (channel) =>
        typeof channel !== 'string' ||
        !allowedSponsorFeedChannels.has(channel as SponsorFeedChannel)
    )
  ) {
    return null;
  }

  return uniqueChannels as readonly SponsorFeedChannel[];
};

const readAdminToken = (request: ApiRequest): string | null => {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const [scheme, token] = authorization.split(/\s+/, 2);
    if (scheme.toLowerCase() === 'bearer' && token) {
      return token;
    }
  }

  const headerToken = request.headers['x-funding-admin-token'];
  return typeof headerToken === 'string' ? headerToken : null;
};

const adminTokenMatches = (candidate: string): boolean => {
  if (!adminToken) {
    return false;
  }

  const candidateBuffer = Buffer.from(candidate);
  const tokenBuffer = Buffer.from(adminToken);
  return (
    candidateBuffer.length === tokenBuffer.length &&
    timingSafeEqual(candidateBuffer, tokenBuffer)
  );
};

const isAdminAuthorized = (request: ApiRequest): boolean => {
  if (!adminToken) {
    return !isProduction;
  }

  const token = readAdminToken(request);
  return Boolean(token && adminTokenMatches(token));
};

const ensureAdminAccess = (
  request: ApiRequest,
  response: ApiResponse
): boolean => {
  if (!adminToken && isProduction) {
    writeJson(request, response, 503, {
      error: 'Admin review is not configured.'
    });
    return false;
  }

  if (!isAdminAuthorized(request)) {
    writeJson(request, response, 401, {
      error: 'Admin authorization is required.'
    });
    return false;
  }

  if (!hasDatabase) {
    writeJson(request, response, 503, {
      error: 'Admin review requires DATABASE_URL and PostgreSQL migrations.'
    });
    return false;
  }

  return true;
};

const resolveCheckoutReturnUrl = (
  candidateUrl: string,
  fallbackPath: string
): string => {
  const fallback = new URL(fallbackPath, publicBaseOrigin);

  try {
    const candidate = new URL(candidateUrl);
    const allowedOriginSet = new Set([
      ...allowedOrigins,
      publicBaseOrigin
    ]);

    if (
      !isProduction &&
      candidate.protocol === 'http:' &&
      (candidate.hostname === 'localhost' || candidate.hostname === '127.0.0.1')
    ) {
      return candidate.toString();
    }

    if (candidate.protocol !== 'https:') {
      return fallback.toString();
    }

    if (candidate.port && allowedReturnHostnames.has(candidate.hostname)) {
      return new URL(
        `${candidate.pathname}${candidate.search}${candidate.hash}`,
        publicBaseOrigin
      ).toString();
    }

    if (allowedOriginSet.has(candidate.origin)) {
      return candidate.toString();
    }
  } catch {
    return fallback.toString();
  }

  return fallback.toString();
};

const routeMatches = (
  url: string | undefined,
  ...candidates: readonly string[]
): boolean => {
  if (!url) {
    return false;
  }

  try {
    return candidates.includes(new URL(url, publicBaseOrigin).pathname);
  } catch {
    return candidates.includes(url);
  }
};

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
const adminRateLimiter = createRateLimiter(
  'admin',
  adminRateLimitMax,
  rateLimitWindowMs
);

const firstHeaderValue = (
  value: string | string[] | undefined
): string | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

const getClientIp = (request: ApiRequest): string => {
  const forwarded = firstHeaderValue(request.headers['x-forwarded-for']);
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }

  return (
    firstHeaderValue(request.headers['x-real-ip']) ??
    request.socket.remoteAddress ??
    'unknown'
  );
};

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

  const now = Date.now();
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
    request.method === 'POST' &&
    routeMatches(request.url, '/checkout-sessions', '/api/checkout-sessions')
  ) {
    return publicWriteRateLimiter;
  }

  if (
    routeMatches(
      request.url,
      '/sponsorship-followup',
      '/api/sponsorship-followup',
      '/sponsorship-followup/details',
      '/api/sponsorship-followup/details'
    )
  ) {
    return sponsorshipFollowupRateLimiter;
  }

  if (
    routeMatches(
      request.url,
      '/admin/sponsorships',
      '/api/admin/sponsorships',
      '/admin/sponsorships/review',
      '/api/admin/sponsorships/review',
      '/admin/sponsorships/publication',
      '/api/admin/sponsorships/publication'
    )
  ) {
    return adminRateLimiter;
  }

  return null;
};

const getDatabaseConnectionStatus = async (): Promise<boolean> => {
  if (!dbPool) {
    return false;
  }

  try {
    await dbPool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

const createDevelopmentCheckoutResult = (
  request: CheckoutRequest
): CheckoutResult => ({
  checkoutId: `stripe-dev-fallback-${request.projectId}-${request.amount}`,
  redirectUrl: request.successUrl,
  status: 'mocked'
});

const resolveStripePaymentIntentId = (
  paymentIntent: string | Stripe.PaymentIntent | null
): string | null => {
  if (!paymentIntent) {
    return null;
  }

  return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id;
};

createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...createCorsHeaders(request),
      ...securityHeaders,
      'Access-Control-Allow-Headers':
        'Content-Type, Stripe-Signature, Authorization, X-Funding-Admin-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    response.end();
    return;
  }

  const rateLimiter = getRequestRateLimiter(request);
  if (rateLimiter && !enforceRateLimit(request, response, rateLimiter)) {
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(request.url, '/checkout-sessions', '/api/checkout-sessions')
  ) {
    let parsed: CheckoutRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as CheckoutRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid checkout request body.'
      });
      return;
    }

    const amount = normalizeAmount(parsed.amount);
    if (!Number.isFinite(amount) || !allowedContributionAmounts.has(amount)) {
      writeJson(request, response, 400, {
        error: 'Checkout amount is not allowed.'
      });
      return;
    }

    if (!isAllowedContributionType(parsed.contributionType)) {
      writeJson(request, response, 400, {
        error: 'Checkout contribution type is not allowed.'
      });
      return;
    }

    if (
      !isBoolean(parsed.publicDisplayConsent) ||
      !isBoolean(parsed.displayAmountConsent) ||
      parsed.nonCharityAcknowledged !== true
    ) {
      writeJson(request, response, 400, {
        error: 'Checkout consent fields are invalid or incomplete.'
      });
      return;
    }

    if (
      parsed.publicDisplayConsent === true &&
      !isNonEmptySponsorText(
        parsed.publicDisplayName,
        PUBLIC_DISPLAY_NAME_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error:
          'Public display name is required when public display consent is granted.'
      });
      return;
    }

    if (
      !isValidOptionalBoundedText(
        parsed.publicDisplayName,
        PUBLIC_DISPLAY_NAME_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Public display name is too long.'
      });
      return;
    }

    if (!stripe) {
      if (!isProduction) {
        writeJson(
          request,
          response,
          200,
          createDevelopmentCheckoutResult(parsed)
        );
        return;
      }

      writeJson(request, response, 503, {
        error: 'Stripe checkout is not configured.'
      });
      return;
    }

    try {
      const successUrl = resolveCheckoutReturnUrl(
        parsed.successUrl,
        '/?checkout=success'
      );
      const cancelUrl = resolveCheckoutReturnUrl(
        parsed.cancelUrl,
        '/?checkout=cancel'
      );
      const requiresReview =
        parsed.contributionType === 'sponsorship_interest';
      const sponsorshipFollowupToken = requiresReview
        ? createSponsorshipFollowupToken()
        : null;
      const sponsorshipFollowupTokenHash = sponsorshipFollowupToken
        ? hashSponsorshipFollowupToken(sponsorshipFollowupToken)
        : null;
      const checkoutSuccessUrl = sponsorshipFollowupToken
        ? appendQueryParam(
            successUrl,
            'followup_token',
            sponsorshipFollowupToken
          )
        : successUrl;
      const publicDisplayName =
        parsed.publicDisplayConsent === true &&
        typeof parsed.publicDisplayName === 'string'
          ? parsed.publicDisplayName.trim()
          : '';
      const checkoutMetadata: Record<string, string> = {
        projectId,
        project: 'openg7',
        program: 'builders_fund',
        contributionType: parsed.contributionType,
        publicDisplayConsent: String(parsed.publicDisplayConsent),
        displayAmountConsent: String(parsed.displayAmountConsent),
        nonCharityAcknowledged: String(parsed.nonCharityAcknowledged),
        requiresReview: String(requiresReview),
        ...(publicDisplayName
          ? {
              publicDisplayName: truncateStripeMetadataValue(publicDisplayName)
            }
          : {}),
        ...(sponsorshipFollowupTokenHash
          ? {
              sponsorshipFollowupTokenHash
            }
          : {})
      };

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: checkoutSuccessUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'cad',
              unit_amount: Math.round(amount * 100),
              product_data: {
                name: `OpenG7 ${projectId}`
              }
            }
          }
        ],
        payment_intent_data: {
          metadata: checkoutMetadata
        },
        metadata: checkoutMetadata
      });
      try {
        await insertCheckoutSessionRecord(dbPool, {
          stripeSessionId: session.id,
          stripePaymentIntentId: resolveStripePaymentIntentId(
            session.payment_intent
          ),
          contributionType: parsed.contributionType,
          amountCents: Math.round(amount * 100),
          currency: 'cad',
          metadata: checkoutMetadata,
          publicDisplayConsent: parsed.publicDisplayConsent,
          publicName: publicDisplayName || null,
          displayAmountConsent: parsed.displayAmountConsent,
          nonCharityAcknowledged: parsed.nonCharityAcknowledged,
          sponsorshipFollowupTokenHash
        });
      } catch (error) {
        console.error('Failed to record Stripe checkout session.', error);
      }

      const result: RedirectCheckoutResult = {
        checkoutId: session.id,
        redirectUrl: session.url ?? successUrl,
        status: 'redirected'
      };

      writeJson(request, response, 200, result);
      return;
    } catch (error) {
      console.error('Failed to create Stripe checkout session.', error);

      if (!isProduction) {
        writeJson(
          request,
          response,
          200,
          createDevelopmentCheckoutResult(parsed)
        );
        return;
      }

      writeJson(request, response, 502, {
        error: 'Stripe checkout session could not be created.'
      });
      return;
    }
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/sponsorship-details',
      '/api/sponsorship-details'
    )
  ) {
    if (!stripe) {
      writeJson(request, response, 503, {
        error: 'Stripe is not configured.'
      });
      return;
    }

    let parsed: SponsorshipDetailsRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as SponsorshipDetailsRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship details request body.'
      });
      return;
    }

    if (
      typeof parsed.sessionId !== 'string' ||
      !parsed.sessionId.startsWith('cs_') ||
      parsed.sessionId.length > 200
    ) {
      writeJson(request, response, 400, {
        error: 'Invalid Stripe checkout session id.'
      });
      return;
    }

    if (!isNonEmptySponsorText(parsed.companyName, SPONSOR_TEXT_MAX_LENGTH)) {
      writeJson(request, response, 400, {
        error: 'Company name is required.'
      });
      return;
    }

    if (!isNonEmptySponsorText(parsed.contactName, SPONSOR_TEXT_MAX_LENGTH)) {
      writeJson(request, response, 400, {
        error: 'Contact name is required.'
      });
      return;
    }

    if (!isValidSponsorEmail(parsed.contactEmail)) {
      writeJson(request, response, 400, {
        error: 'A valid contact email is required.'
      });
      return;
    }

    if (!isValidOptionalHttpsUrl(parsed.websiteUrl)) {
      writeJson(request, response, 400, {
        error: 'Website URL must be a valid https link.'
      });
      return;
    }

    if (!isValidOptionalHttpsUrl(parsed.logoUrl)) {
      writeJson(request, response, 400, {
        error: 'Logo URL must be a valid https link.'
      });
      return;
    }

    if (
      parsed.message !== undefined &&
      (typeof parsed.message !== 'string' ||
        parsed.message.length > SPONSOR_MESSAGE_MAX_LENGTH)
    ) {
      writeJson(request, response, 400, {
        error: 'Message is too long.'
      });
      return;
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(parsed.sessionId, {
        expand: ['payment_intent']
      });
    } catch {
      writeJson(request, response, 404, {
        error: 'Checkout session not found.'
      });
      return;
    }

    const sessionMetadata = session.metadata ?? {};
    if (
      normalizeContributionType(sessionMetadata.contributionType) !==
      'sponsorship_interest'
    ) {
      writeJson(request, response, 400, {
        error: 'This checkout session is not a sponsorship interest contribution.'
      });
      return;
    }

    if (session.payment_status !== 'paid') {
      writeJson(request, response, 409, {
        error: 'Payment for this checkout session is not confirmed yet.'
      });
      return;
    }

    const paymentIntentId = resolveStripePaymentIntentId(
      session.payment_intent
    );
    const paymentIntentCreatedIso =
      session.payment_intent && typeof session.payment_intent !== 'string'
        ? new Date(session.payment_intent.created * 1000).toISOString()
        : new Date(session.created * 1000).toISOString();

    const companyName = parsed.companyName.trim();
    const contactName = parsed.contactName.trim();
    const contactEmail = parsed.contactEmail.trim();
    const websiteUrl = parsed.websiteUrl?.trim() || null;
    const logoUrl = parsed.logoUrl?.trim() || null;
    const message = parsed.message?.trim() || null;

    if (paymentIntentId) {
      try {
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: {
            sponsorCompanyName: truncateStripeMetadataValue(companyName),
            sponsorContactName: truncateStripeMetadataValue(contactName),
            sponsorContactEmail: truncateStripeMetadataValue(contactEmail),
            ...(websiteUrl
              ? { sponsorWebsiteUrl: truncateStripeMetadataValue(websiteUrl) }
              : {}),
            ...(logoUrl
              ? { sponsorLogoUrl: truncateStripeMetadataValue(logoUrl) }
              : {}),
            ...(message
              ? { sponsorMessage: truncateStripeMetadataValue(message) }
              : {})
          }
        });
      } catch (error) {
        console.error(
          'Failed to update Stripe metadata with sponsorship details.',
          error
        );
      }
    }

    let recorded = false;
    try {
      recorded = await recordSponsorshipDetails(dbPool, {
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? 'cad',
        publicDisplayConsent: parseMetadataBoolean(
          sessionMetadata.publicDisplayConsent
        ),
        displayAmountConsent: parseMetadataBoolean(
          sessionMetadata.displayAmountConsent
        ),
        nonCharityAcknowledged: parseMetadataBoolean(
          sessionMetadata.nonCharityAcknowledged
        ),
        paidAtIso: paymentIntentCreatedIso,
        companyName,
        contactName,
        contactEmail,
        websiteUrl,
        logoUrl,
        message
      });
    } catch (error) {
      console.error('Failed to record sponsorship details.', error);
    }

    const result: SponsorshipDetailsResult = { received: true, recorded };
    writeJson(request, response, 200, result);
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/sponsorship-followup',
      '/api/sponsorship-followup'
    )
  ) {
    if (!hasDatabase) {
      writeJson(request, response, 503, {
        error: 'Sponsorship follow-up requires DATABASE_URL.'
      });
      return;
    }

    const token = new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
      'token'
    );
    if (!isValidFollowupToken(token)) {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship follow-up token.'
      });
      return;
    }

    try {
      const followup = await getSponsorshipFollowupByTokenHash(
        dbPool,
        hashSponsorshipFollowupToken(token),
        getSponsorshipFollowupTokenCutoffIso()
      );

      if (!followup) {
        writeJson(request, response, 404, {
          error: 'Sponsorship follow-up was not found.'
        });
        return;
      }

      const result: SponsorshipFollowupResponse = {
        found: true,
        paymentStatus: followup.paymentStatus,
        reviewStatus: followup.reviewStatus,
        amount: followup.amount,
        currency: followup.currency,
        paidAt: followup.paidAt,
        detailsSubmitted: followup.detailsSubmitted,
        companyName: followup.companyName,
        contactName: followup.contactName,
        contactEmail: followup.contactEmail,
        websiteUrl: followup.websiteUrl,
        logoUrl: followup.logoUrl,
        message: followup.message,
        reviewedAt: followup.reviewedAt
      };

      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load sponsorship follow-up.', error);
      writeJson(request, response, 502, {
        error: 'Sponsorship follow-up could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/sponsorship-followup/details',
      '/api/sponsorship-followup/details'
    )
  ) {
    if (!hasDatabase) {
      writeJson(request, response, 503, {
        error: 'Sponsorship follow-up requires DATABASE_URL.'
      });
      return;
    }

    let parsed: SponsorshipFollowupDetailsRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as SponsorshipFollowupDetailsRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship follow-up request body.'
      });
      return;
    }

    if (!isValidFollowupToken(parsed.token)) {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship follow-up token.'
      });
      return;
    }

    if (!isNonEmptySponsorText(parsed.companyName, SPONSOR_TEXT_MAX_LENGTH)) {
      writeJson(request, response, 400, {
        error: 'Company name is required.'
      });
      return;
    }

    if (!isNonEmptySponsorText(parsed.contactName, SPONSOR_TEXT_MAX_LENGTH)) {
      writeJson(request, response, 400, {
        error: 'Contact name is required.'
      });
      return;
    }

    if (!isValidSponsorEmail(parsed.contactEmail)) {
      writeJson(request, response, 400, {
        error: 'A valid contact email is required.'
      });
      return;
    }

    if (!isValidOptionalHttpsUrl(parsed.websiteUrl)) {
      writeJson(request, response, 400, {
        error: 'Website URL must be a valid https link.'
      });
      return;
    }

    if (!isValidOptionalHttpsUrl(parsed.logoUrl)) {
      writeJson(request, response, 400, {
        error: 'Logo URL must be a valid https link.'
      });
      return;
    }

    if (
      parsed.message !== undefined &&
      (typeof parsed.message !== 'string' ||
        parsed.message.length > SPONSOR_MESSAGE_MAX_LENGTH)
    ) {
      writeJson(request, response, 400, {
        error: 'Message is too long.'
      });
      return;
    }

    try {
      const followup = await getSponsorshipFollowupByTokenHash(
        dbPool,
        hashSponsorshipFollowupToken(parsed.token),
        getSponsorshipFollowupTokenCutoffIso()
      );

      if (!followup) {
        writeJson(request, response, 404, {
          error: 'Sponsorship follow-up was not found.'
        });
        return;
      }

      if (!followupEditablePaymentStatuses.has(followup.paymentStatus)) {
        writeJson(request, response, 409, {
          error: 'Payment for this sponsorship is not confirmed yet.'
        });
        return;
      }

      const companyName = parsed.companyName.trim();
      const contactName = parsed.contactName.trim();
      const contactEmail = parsed.contactEmail.trim();
      const websiteUrl = parsed.websiteUrl?.trim() || null;
      const logoUrl = parsed.logoUrl?.trim() || null;
      const message = parsed.message?.trim() || null;

      if (stripe && followup.stripePaymentIntentId) {
        try {
          await stripe.paymentIntents.update(followup.stripePaymentIntentId, {
            metadata: {
              sponsorCompanyName: truncateStripeMetadataValue(companyName),
              sponsorContactName: truncateStripeMetadataValue(contactName),
              sponsorContactEmail: truncateStripeMetadataValue(contactEmail),
              ...(websiteUrl
                ? {
                    sponsorWebsiteUrl:
                      truncateStripeMetadataValue(websiteUrl)
                  }
                : {}),
              ...(logoUrl
                ? { sponsorLogoUrl: truncateStripeMetadataValue(logoUrl) }
                : {}),
              ...(message
                ? { sponsorMessage: truncateStripeMetadataValue(message) }
                : {})
            }
          });
        } catch (error) {
          console.error(
            'Failed to update Stripe metadata with follow-up details.',
            error
          );
        }
      }

      const recorded = await recordSponsorshipDetailsForContribution(dbPool, {
        contributionId: followup.contributionId,
        companyName,
        contactName,
        contactEmail,
        websiteUrl,
        logoUrl,
        message
      });

      const result: SponsorshipDetailsResult = { received: true, recorded };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to record sponsorship follow-up details.', error);
      writeJson(request, response, 502, {
        error: 'Sponsorship follow-up details could not be recorded.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(request.url, '/stripe/webhook', '/api/stripe/webhook')
  ) {
    if (!stripe || !stripeWebhookSecret) {
      writeJson(request, response, 503, {
        error:
          'Stripe webhook is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.'
      });
      return;
    }

    const stripeSignature = request.headers['stripe-signature'];
    if (typeof stripeSignature !== 'string') {
      writeJson(request, response, 400, {
        error: 'Missing Stripe-Signature header'
      });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(request);
    } catch {
      writeJson(request, response, 413, {
        error: 'Webhook request body is too large.'
      });
      return;
    }

    const result = await processStripeWebhook(rawBody, stripeSignature, {
      stripe,
      webhookSecret: stripeWebhookSecret,
      pool: dbPool,
      publicBaseUrl: publicBaseUrl ?? publicBaseOrigin
    });

    writeJson(request, response, result.statusCode, result.payload);
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/sponsorships',
      '/api/admin/sponsorships'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const sponsorships = await listAdminSponsorships(dbPool);
      const lastUpdatedAt =
        sponsorships.reduce<string | null>((latest, sponsorship) => {
          if (!latest) {
            return sponsorship.updated_at;
          }

          return new Date(sponsorship.updated_at).getTime() >
            new Date(latest).getTime()
            ? sponsorship.updated_at
            : latest;
        }, null) ?? new Date().toISOString();
      const result: AdminSponsorshipsResponse = {
        data_source: 'database',
        sponsorships,
        last_updated_at: lastUpdatedAt
      };

      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load admin sponsorships.', error);
      writeJson(request, response, 502, {
        error: 'Admin sponsorships could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/review',
      '/api/admin/sponsorships/review'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminSponsorshipReviewRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminSponsorshipReviewRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship review request body.'
      });
      return;
    }

    if (
      typeof parsed.contributionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parsed.contributionId
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Invalid contribution id.'
      });
      return;
    }

    if (!isAllowedSponsorshipReviewStatus(parsed.reviewStatus)) {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship review status.'
      });
      return;
    }

    if (
      !isValidOptionalBoundedText(
        parsed.reviewNote,
        ADMIN_REVIEW_NOTE_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Review note is too long.'
      });
      return;
    }

    try {
      const updated = await updateSponsorshipReview(dbPool, {
        contributionId: parsed.contributionId,
        reviewStatus: parsed.reviewStatus,
        reviewNote:
          typeof parsed.reviewNote === 'string' &&
          parsed.reviewNote.trim().length > 0
            ? parsed.reviewNote.trim()
            : null
      });

      if (!updated) {
        writeJson(request, response, 404, {
          error: 'Sponsorship contribution was not found.'
        });
        return;
      }

      const result: AdminSponsorshipReviewResult = {
        updated,
        reviewStatus: parsed.reviewStatus
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to update sponsorship review.', error);
      writeJson(request, response, 502, {
        error: 'Sponsorship review could not be updated.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/publication',
      '/api/admin/sponsorships/publication'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminSponsorshipPublicationRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminSponsorshipPublicationRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship publication request body.'
      });
      return;
    }

    if (
      typeof parsed.contributionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parsed.contributionId
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Invalid contribution id.'
      });
      return;
    }

    if (!isValidOptionalPublicSlug(parsed.publicSlug)) {
      writeJson(request, response, 400, {
        error: 'Public slug must use lowercase letters, numbers, and hyphens.'
      });
      return;
    }

    if (
      !isValidOptionalBoundedText(
        parsed.publicSummary,
        SPONSOR_PUBLIC_SUMMARY_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Public summary is too long.'
      });
      return;
    }

    if (!isAllowedSponsorFeedTarget(parsed.feedTarget)) {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship feed target.'
      });
      return;
    }

    const feedChannels = parseSponsorFeedChannelsFromRequest(
      parsed.feedChannels
    );
    if (!feedChannels) {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship feed channels.'
      });
      return;
    }

    if (!isAllowedSponsorFeedStatus(parsed.feedStatus)) {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship feed status.'
      });
      return;
    }

    if (!isValidOptionalHttpsUrl(parsed.feedPublicUrl)) {
      writeJson(request, response, 400, {
        error: 'Feed public URL must be a valid https link.'
      });
      return;
    }

    if (
      !isValidOptionalBoundedText(
        parsed.feedNotes,
        SPONSOR_FEED_NOTES_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Feed notes are too long.'
      });
      return;
    }

    try {
      const updated = await updateSponsorshipPublication(dbPool, {
        contributionId: parsed.contributionId,
        publicSlug:
          typeof parsed.publicSlug === 'string' &&
          parsed.publicSlug.trim().length > 0
            ? parsed.publicSlug.trim()
            : undefined,
        publicSummary:
          typeof parsed.publicSummary === 'string' &&
          parsed.publicSummary.trim().length > 0
            ? parsed.publicSummary.trim()
            : undefined,
        feedTarget:
          typeof parsed.feedTarget === 'string' &&
          parsed.feedTarget.trim().length > 0
            ? parsed.feedTarget
            : null,
        feedChannels,
        feedStatus: parsed.feedStatus,
        feedPublicUrl:
          typeof parsed.feedPublicUrl === 'string' &&
          parsed.feedPublicUrl.trim().length > 0
            ? parsed.feedPublicUrl.trim()
            : undefined,
        feedNotes:
          typeof parsed.feedNotes === 'string' &&
          parsed.feedNotes.trim().length > 0
            ? parsed.feedNotes.trim()
            : undefined
      });

      if (!updated) {
        writeJson(request, response, 404, {
          error: 'Sponsorship contribution was not found.'
        });
        return;
      }

      const result: AdminSponsorshipPublicationResult = {
        updated,
        feedStatus: parsed.feedStatus
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to update sponsorship publication.', error);
      writeJson(request, response, 502, {
        error: 'Sponsorship publication could not be updated.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/public/sponsorships',
      '/api/public/sponsorships'
    )
  ) {
    try {
      const sponsorships = await listPublicSponsorships(dbPool);

      writeJson(request, response, 200, sponsorships);
    } catch (error) {
      console.error('Failed to load public sponsorships.', error);
      writeJson(request, response, 502, {
        error: 'Public sponsorships could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/public/fund-transparency',
      '/api/public/fund-transparency'
    )
  ) {
    try {
      const summary = hasDatabase
        ? await getPublicTransparencySummary(dbPool)
        : stripe
          ? await getStripePublicTransparencySummary(stripe, { projectId })
          : await getPublicTransparencySummary(null);

      writeJson(request, response, 200, summary);
    } catch (error) {
      console.error('Failed to build public fund transparency summary.', error);
      writeJson(request, response, 502, {
        error:
          'Public fund transparency summary could not be loaded from Stripe.'
      });
    }
    return;
  }

  if (request.method === 'GET' && routeMatches(request.url, '/health')) {
    writeText(request, response, 200, 'ok');
    return;
  }

  if (
    !isProduction &&
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/dev/stripe-setup-status',
      '/api/dev/stripe-setup-status'
    )
  ) {
    writeJson(request, response, 200, {
      environment: process.env.FUNDING_PLATFORM_ENV ?? 'development',
      apiReachable: true,
      stripeSecretKeyConfigured: Boolean(stripeSecretKey),
      stripeWebhookSecretConfigured: Boolean(stripeWebhookSecret),
      databaseUrlConfigured: hasDatabase,
      databaseReachable: await getDatabaseConnectionStatus(),
      transparencySource: hasDatabase ? 'database' : stripe ? 'stripe' : 'none',
      localApiBaseUrl: `http://localhost:${port}`,
      checkoutEndpoint: `http://localhost:${port}/api/checkout-sessions`,
      webhookEndpoint: `http://localhost:${port}/api/stripe/webhook`,
      publicTransparencyEndpoint: `http://localhost:${port}/api/public/fund-transparency`,
      stripeDashboardUrl: 'https://dashboard.stripe.com/test/webhooks',
      lastCheckedAt: new Date().toISOString()
    });
    return;
  }

  writeJson(request, response, 404, { error: 'Not found' });
}).listen(port, () => {
  console.log(`Funding API listening on http://localhost:${port}`);
  if (!hasDatabase) {
    console.info(
      'DATABASE_URL is not configured. Using Stripe-direct public transparency.'
    );
  }
});
