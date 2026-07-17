import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

import Stripe from 'stripe';
import type {
  AdminContributionRecord,
  AdminEmailTestRequest,
  AdminEmailTestResult,
  AdminExpenseCreateRequest,
  AdminExpenseUpdateRequest,
  AdminSetupStatusResponse,
  AdminTransparencyResponse,
  AdminPublicationBatchAssignRequest,
  AdminPublicationBatchCreateRequest,
  AdminPublicationBatchLifecycleRequest,
  AdminPublicationBatchScheduleRequest,
  AdminPublicationBatchUnassignRequest,
  AdminPublicationDraftCreateRequest,
  AdminPublicationDraftUpdateRequest,
  AdminSessionCreateRequest,
  AdminSessionResponse,
  AdminSponsorLogoDeleteRequest,
  AdminSponsorLogoDeleteResult,
  AdminSponsorLogoUploadResult,
  AdminSponsorshipPublicationRequest,
  AdminSponsorshipPublicationResult,
  AdminSponsorshipReviewRequest,
  AdminSponsorshipReviewResult,
  AdminSponsorshipsResponse,
  ContributionType,
  CheckoutResult,
  CheckoutRequest,
  PublicFundingRuntimeConfig,
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

import {
  allowedAdminExpenseStatuses,
  allowedPublicationDraftStatuses,
  assignDraftToPublicationBatch,
  cancelAdminPublicationBatch,
  createAdminExpense,
  createAdminPublicationBatch,
  createAdminPublicationDraft,
  getPublicationBatchById,
  getPublicSponsorshipBatchAvailability,
  insertAdminAuditLog,
  listAdminExpenses,
  listAdminAuditLog,
  listAdminPublicationBatches,
  listAdminPublicationDrafts,
  publishAdminPublicationBatch,
  scheduleAdminPublicationBatch,
  unassignDraftFromPublicationBatch,
  updateAdminExpense,
  updateAdminPublicationDraft
} from './fund-admin.repository.js';
import { dbPool, hasDatabase } from './database.js';
import {
  getEmailQueueStatus,
  processQueuedEmailMessages,
  queueEmailConfigurationTest,
  queuePublicationBatchFullNotification
} from './email-notification.service.js';
import {
  allowedSponsorFeedChannels,
  allowedSponsorFeedStatuses,
  allowedSponsorFeedTargets,
  clearSponsorshipLogoUrl,
  getAdminDashboard,
  getAdminSponsorshipLogoUrl,
  allowedSponsorshipReviewStatuses,
  insertCheckoutSessionRecord,
  getSponsorshipFollowupByTokenHash,
  isPublicApprovedSponsorshipLogoUrl,
  listPublicSponsorships,
  listAdminContributions,
  listAdminSponsorships,
  normalizeContributionType,
  parseMetadataBoolean,
  recordSponsorshipDetailsForContribution,
  recordSponsorshipDetails,
  updateSponsorshipLogoUrl,
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

const parseBooleanEnv = (
  value: string | undefined,
  fallback: boolean
): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const port = Number(process.env.FUNDING_API_PORT ?? 3333);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const projectId = process.env.FUNDING_PROJECT_ID ?? 'openg7';
const isProduction = process.env.FUNDING_PLATFORM_ENV === 'production';
const businessSponsorshipEnabled = parseBooleanEnv(
  process.env.FUNDING_BUSINESS_SPONSORSHIP_ENABLED,
  false
);
const adminToken = process.env.FUNDING_ADMIN_TOKEN?.trim() ?? '';
const adminSessionSecret =
  process.env.FUNDING_ADMIN_SESSION_SECRET?.trim() ?? '';
const adminSessionTtlMinutes = parsePositiveIntegerEnv(
  process.env.FUNDING_ADMIN_SESSION_TTL_MINUTES,
  60
);
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
const emailQueuePollIntervalMs = parsePositiveIntegerEnv(
  process.env.FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS,
  30_000
);
const emailQueueBatchSize = parsePositiveIntegerEnv(
  process.env.FUNDING_EMAIL_QUEUE_BATCH_SIZE,
  10
);
const sponsorLogoMaxBytes = parsePositiveIntegerEnv(
  process.env.FUNDING_SPONSOR_LOGO_MAX_BYTES,
  512 * 1024
);
const sponsorLogoStorageDir = path.resolve(
  process.env.FUNDING_SPONSOR_LOGO_STORAGE_DIR ?? 'var/sponsor-logos'
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
// Mirrors the sponsorship pricing floor in
// apps/funding-web/src/app/features/funding/config/openg7-funding.config.ts.
// Kept in sync by hand, same as allowedContributionAmounts/FUNDING_ALLOWED_AMOUNTS above:
// `@openg7/funding-core` has no local package build, so a real (non-type)
// cross-package import only resolves inside the Angular bundle, not here.
const sponsorshipMinimumAmount = 5;

const isValidSponsorshipAmount = (amount: number): boolean =>
  Number.isFinite(amount) && amount >= sponsorshipMinimumAmount;

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

const writeCsv = (
  request: ApiRequest,
  response: ApiResponse,
  statusCode: number,
  payload: string,
  filename: string
): void => {
  response.writeHead(statusCode, {
    ...createCorsHeaders(request),
    ...securityHeaders,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Type': 'text/csv; charset=utf-8'
  });
  response.end(payload);
};

const writeBinary = (
  request: ApiRequest,
  response: ApiResponse,
  statusCode: number,
  payload: Buffer,
  contentType: string,
  extraHeaders: Record<string, string> = {}
): void => {
  response.writeHead(statusCode, {
    ...createCorsHeaders(request),
    ...securityHeaders,
    ...extraHeaders,
    'Content-Length': String(payload.byteLength),
    'Content-Type': contentType
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

const readBodyBuffer = async (
  request: ApiRequest,
  maxBytes: number
): Promise<Buffer> => {
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
  return Buffer.concat(chunks);
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
const PUBLICATION_DRAFT_TITLE_MAX_LENGTH = 160;
const PUBLICATION_DRAFT_BODY_MAX_LENGTH = 2500;
const PUBLICATION_DRAFT_DISCLOSURE_MAX_LENGTH = 300;
const PUBLICATION_BATCH_NOTES_MAX_LENGTH = 500;
const PUBLICATION_BATCH_MIN_CAPACITY = 1;
const PUBLICATION_BATCH_MAX_CAPACITY = 50;
const ADMIN_EXPENSE_NAME_MAX_LENGTH = 160;
const ADMIN_EXPENSE_DESCRIPTION_MAX_LENGTH = 1000;
const FOLLOWUP_TOKEN_BYTES = 32;
const CONTRIBUTION_REFERENCE_BYTES = 6;
const CONTRIBUTION_REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const contributionPublicReferencePattern = /^OG7-\d{4}-[A-Z0-9]{4,8}$/;
const ADMIN_SESSION_TOKEN_PREFIX = 'openg7-admin-session.';
const ADMIN_SESSION_NONCE_BYTES = 16;
const SPONSOR_LOGO_PUBLIC_PATH_PREFIX = '/api/public/sponsor-logos/';
const SPONSOR_LOGO_FILENAME_PATTERN =
  /^sponsor-logo-[0-9a-f-]{36}-[0-9]{13}-[a-f0-9]{16}\.(?:jpg|png|webp)$/;
const sponsorLogoContentTypes = new Map<string, string>([
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp']
]);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const RATE_LIMIT_BUCKET_PRUNE_THRESHOLD = 5000;
const followupEditablePaymentStatuses = new Set([
  'paid',
  'refunded',
  'disputed'
]);

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

const isValidOptionalNonEmptyBoundedText = (
  value: unknown,
  maxLength: number
): boolean =>
  value === undefined ||
  (typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength);

const isValidOptionalPublicSlug = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'string' &&
    value.trim().length <= SPONSOR_PUBLIC_SLUG_MAX_LENGTH &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim()));

const isValidUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

interface MultipartPart {
  readonly name: string;
  readonly filename: string | null;
  readonly contentType: string | null;
  readonly data: Buffer;
}

interface SponsorLogoFile {
  readonly data: Buffer;
  readonly extension: 'jpg' | 'png' | 'webp';
  readonly filename: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly sizeBytes: number;
}

const parseMultipartBoundary = (
  contentType: string | string[] | undefined
): string | null => {
  const header = firstHeaderValue(contentType);
  if (!header?.toLowerCase().startsWith('multipart/form-data')) {
    return null;
  }

  const match = /(?:^|;\s*)boundary=(?:"([^"]+)"|([^;]+))/i.exec(header);
  const boundary = match?.[1] ?? match?.[2] ?? '';
  return boundary.length > 0 && boundary.length <= 200 ? boundary : null;
};

const splitBuffer = (buffer: Buffer, delimiter: Buffer): Buffer[] => {
  const parts: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);

  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + delimiter.byteLength;
    index = buffer.indexOf(delimiter, start);
  }

  parts.push(buffer.subarray(start));
  return parts;
};

const trimMultipartPart = (part: Buffer): Buffer => {
  let start = 0;
  let end = part.byteLength;

  if (part.subarray(0, 2).equals(Buffer.from('\r\n'))) {
    start = 2;
  }

  if (part.subarray(end - 2, end).equals(Buffer.from('\r\n'))) {
    end -= 2;
  }

  return part.subarray(start, end);
};

const parseMultipartPartHeaders = (
  headerText: string
): Record<string, string> =>
  Object.fromEntries(
    headerText
      .split('\r\n')
      .map((line) => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) {
          return null;
        }

        return [
          line.slice(0, separatorIndex).trim().toLowerCase(),
          line.slice(separatorIndex + 1).trim()
        ] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  );

const parseContentDispositionValue = (
  value: string,
  key: 'name' | 'filename'
): string | null => {
  const match = new RegExp(`${key}="([^"]*)"`).exec(value);
  return match?.[1] ?? null;
};

const parseMultipartFormData = (
  body: Buffer,
  boundary: string
): readonly MultipartPart[] => {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const rawParts = splitBuffer(body, boundaryBuffer).slice(1);
  const parts: MultipartPart[] = [];

  for (const rawPart of rawParts) {
    if (
      rawPart.subarray(0, 2).equals(Buffer.from('--')) ||
      rawPart.subarray(0, 4).equals(Buffer.from('--\r\n'))
    ) {
      continue;
    }

    const part = trimMultipartPart(rawPart);
    const headerEndIndex = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEndIndex === -1) {
      continue;
    }

    const headers = parseMultipartPartHeaders(
      part.subarray(0, headerEndIndex).toString('utf8')
    );
    const disposition = headers['content-disposition'] ?? '';
    const name = parseContentDispositionValue(disposition, 'name');
    if (!name) {
      continue;
    }

    parts.push({
      name,
      filename: parseContentDispositionValue(disposition, 'filename'),
      contentType: headers['content-type']?.toLowerCase() ?? null,
      data: part.subarray(headerEndIndex + 4)
    });
  }

  return parts;
};

const detectSponsorLogoFileType = (
  data: Buffer
): Pick<SponsorLogoFile, 'extension' | 'mimeType'> | null => {
  if (
    data.length >= 8 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { extension: 'png', mimeType: 'image/png' };
  }

  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }

  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', mimeType: 'image/webp' };
  }

  return null;
};

const createSponsorLogoFilename = (
  contributionId: string,
  extension: SponsorLogoFile['extension']
): string =>
  `sponsor-logo-${contributionId.toLowerCase()}-${Date.now()}-${randomBytes(8).toString('hex')}.${extension}`;

const parseSponsorLogoUpload = (
  parts: readonly MultipartPart[],
  contributionId: string
): SponsorLogoFile | null => {
  const filePart = parts.find((part) => part.name === 'logo');
  if (!filePart?.filename || filePart.data.byteLength === 0) {
    return null;
  }

  if (filePart.data.byteLength > sponsorLogoMaxBytes) {
    return null;
  }

  const detected = detectSponsorLogoFileType(filePart.data);
  if (!detected || filePart.contentType !== detected.mimeType) {
    return null;
  }

  return {
    data: filePart.data,
    extension: detected.extension,
    filename: createSponsorLogoFilename(contributionId, detected.extension),
    mimeType: detected.mimeType,
    sizeBytes: filePart.data.byteLength
  };
};

const sponsorLogoPublicUrlForFilename = (filename: string): string =>
  `${SPONSOR_LOGO_PUBLIC_PATH_PREFIX}${filename}`;

const resolveSponsorLogoFilePath = (filename: string): string | null => {
  if (!SPONSOR_LOGO_FILENAME_PATTERN.test(filename)) {
    return null;
  }

  const resolvedFilePath = path.resolve(sponsorLogoStorageDir, filename);
  if (!resolvedFilePath.startsWith(`${sponsorLogoStorageDir}${path.sep}`)) {
    return null;
  }

  return resolvedFilePath;
};

const getSponsorLogoFilenameFromUrl = (
  url: string | undefined
): string | null => {
  if (!url) {
    return null;
  }

  try {
    const pathname = new URL(url, publicBaseOrigin).pathname;
    const allowedPrefixes = [
      SPONSOR_LOGO_PUBLIC_PATH_PREFIX,
      SPONSOR_LOGO_PUBLIC_PATH_PREFIX.replace('/api', '')
    ];
    const prefix = allowedPrefixes.find((candidate) =>
      pathname.startsWith(candidate)
    );

    if (!prefix) {
      return null;
    }

    return decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
};

const contentTypeForSponsorLogoFilename = (filename: string): string | null =>
  sponsorLogoContentTypes.get(filename.split('.').at(-1) ?? '') ?? null;

const deleteControlledSponsorLogoFile = async (
  logoUrl: string | null
): Promise<boolean> => {
  const filename = getSponsorLogoFilenameFromUrl(logoUrl ?? undefined);
  if (!filename) {
    return false;
  }

  const filePath = resolveSponsorLogoFilePath(filename);
  if (!filePath) {
    return false;
  }

  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Failed to delete controlled sponsor logo file.', error);
    }
    return false;
  }
};

const isValidOptionalIsoDate = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  return typeof value === 'string' && Number.isFinite(Date.parse(value));
};

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

const createContributionPublicReference = (): string => {
  const bytes = randomBytes(CONTRIBUTION_REFERENCE_BYTES);
  const suffix = Array.from(bytes, (byte) =>
    CONTRIBUTION_REFERENCE_ALPHABET.charAt(
      byte % CONTRIBUTION_REFERENCE_ALPHABET.length
    )
  ).join('');

  return `OG7-${new Date().getUTCFullYear()}-${suffix}`;
};

const normalizeContributionPublicReference = (
  value: string | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  const reference = value.trim().toUpperCase();
  return contributionPublicReferencePattern.test(reference) ? reference : null;
};

const buildContributionReceiptDescription = (publicReference: string): string =>
  `Reference OpenG7: ${publicReference}`;

const buildSponsorshipCheckoutSuccessUrl = (
  returnUrl: string,
  token: string
): string => {
  const url = new URL(returnUrl, publicBaseOrigin);
  const isEnglishPath =
    url.pathname === '/en' || url.pathname.startsWith('/en/');
  url.pathname = `${
    isEnglishPath ? '/en' : ''
  }/fonds-des-batisseurs/suivi-commandite`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('token', token);
  return url.toString();
};

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

const isAllowedSponsorFeedChannel = (
  value: unknown
): value is SponsorFeedChannel =>
  typeof value === 'string' &&
  allowedSponsorFeedChannels.has(value as SponsorFeedChannel);

const adminSponsorshipPageSizes = new Set([6, 10, 25]);
const adminSponsorshipPaymentStatuses = new Set([
  'paid',
  'refunded',
  'disputed'
]);
const adminSponsorshipSorts = new Set([
  'priority',
  'paid_at',
  'submitted_at',
  'amount',
  'company',
  'updated_at'
]);

const isValidAdminExpectedVersion = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= 128;

const parseAdminSponsorshipsQuery = (
  url: string | undefined
): Parameters<typeof listAdminSponsorships>[1] => {
  const searchParams = new URL(url ?? '/', publicBaseOrigin).searchParams;
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const requestedPageSize = Number.parseInt(
    searchParams.get('pageSize') ?? '6',
    10
  );
  const reviewStatus =
    searchParams.get('reviewStatus') === 'pending'
      ? 'pending_review'
      : searchParams.get('reviewStatus');
  const feedStatus = searchParams.get('feedStatus');
  const paymentStatus = searchParams.get('paymentStatus');
  const sort = searchParams.get('sort');
  const direction = searchParams.get('direction');
  const search = searchParams.get('search')?.trim();

  return {
    page:
      Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: adminSponsorshipPageSizes.has(requestedPageSize)
      ? requestedPageSize
      : 6,
    search: search || undefined,
    reviewStatus:
      reviewStatus &&
      allowedSponsorshipReviewStatuses.has(
        reviewStatus as SponsorshipReviewStatus
      )
        ? (reviewStatus as SponsorshipReviewStatus)
        : undefined,
    feedStatus:
      feedStatus &&
      allowedSponsorFeedStatuses.has(feedStatus as SponsorFeedStatus)
        ? (feedStatus as SponsorFeedStatus)
        : undefined,
    paymentStatus:
      paymentStatus && adminSponsorshipPaymentStatuses.has(paymentStatus)
        ? (paymentStatus as 'paid' | 'refunded' | 'disputed')
        : undefined,
    sort:
      sort && adminSponsorshipSorts.has(sort)
        ? (sort as NonNullable<
            Parameters<typeof listAdminSponsorships>[1]['sort']
          >)
        : 'priority',
    direction: direction === 'asc' ? 'asc' : 'desc'
  };
};

const writeSponsorshipMutationFailure = (
  request: IncomingMessage,
  response: ServerResponse,
  status: 'updated' | 'not_found' | 'conflict' | 'payment_not_eligible',
  details: {
    readonly currentVersion?: string | null;
    readonly paymentStatus?: string | null;
  } = {}
): void => {
  if (status === 'conflict') {
    writeJson(request, response, 409, {
      code: 'SPONSORSHIP_CONCURRENT_UPDATE',
      message: 'Cette commandite a ete modifiee par un autre administrateur.',
      currentVersion: details.currentVersion ?? null
    });
    return;
  }

  if (status === 'payment_not_eligible') {
    writeJson(request, response, 409, {
      code: 'SPONSORSHIP_PAYMENT_NOT_ELIGIBLE',
      message:
        'Cette commandite ne peut pas etre publiee ou approuvee lorsque le paiement est rembourse ou conteste.',
      paymentStatus: details.paymentStatus ?? null
    });
    return;
  }

  writeJson(request, response, 404, {
    error: 'Sponsorship contribution was not found.'
  });
};

const isValidPublicationBatchCapacity = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= PUBLICATION_BATCH_MIN_CAPACITY &&
  value <= PUBLICATION_BATCH_MAX_CAPACITY;

const channelLabel = (channel: SponsorFeedChannel): string =>
  channel === 'linkedin' ? 'LinkedIn' : 'Facebook';

const isAllowedPublicationDraftStatus = (
  value: unknown
): value is NonNullable<AdminPublicationDraftUpdateRequest['status']> =>
  typeof value === 'string' &&
  allowedPublicationDraftStatuses.has(
    value as NonNullable<AdminPublicationDraftUpdateRequest['status']>
  );

const isAllowedAdminExpenseStatus = (
  value: unknown
): value is NonNullable<AdminExpenseUpdateRequest['status']> =>
  typeof value === 'string' &&
  allowedAdminExpenseStatuses.has(
    value as NonNullable<AdminExpenseUpdateRequest['status']>
  );

const isValidAdminExpenseId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);

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

interface AdminSessionPayload {
  readonly actor: 'funding-admin-session';
  readonly exp: number;
  readonly iat: number;
  readonly nonce: string;
  readonly v: 1;
}

interface AdminAuthorization {
  readonly actor:
    'funding-admin-session' | 'funding-admin-token' | 'local-dev-admin';
  readonly source: 'session' | 'static-token' | 'local-dev';
}

const getAdminSessionSigningSecret = (): string | null =>
  adminSessionSecret || adminToken || (!isProduction ? projectId : null);

const signAdminSessionPayload = (encodedPayload: string): string | null => {
  const signingSecret = getAdminSessionSigningSecret();
  if (!signingSecret) {
    return null;
  }

  return createHmac('sha256', signingSecret)
    .update(encodedPayload)
    .digest('base64url');
};

const adminSessionSignatureMatches = (
  encodedPayload: string,
  signature: string
): boolean => {
  const expectedSignature = signAdminSessionPayload(encodedPayload);
  if (!expectedSignature) {
    return false;
  }

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  return (
    signatureBuffer.length === expectedBuffer.length &&
    timingSafeEqual(signatureBuffer, expectedBuffer)
  );
};

const createAdminSession = (now = Date.now()): AdminSessionResponse | null => {
  const expiresAtMs = now + adminSessionTtlMinutes * 60 * 1000;
  const payload: AdminSessionPayload = {
    actor: 'funding-admin-session',
    exp: expiresAtMs,
    iat: now,
    nonce: randomBytes(ADMIN_SESSION_NONCE_BYTES).toString('base64url'),
    v: 1
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url'
  );
  const signature = signAdminSessionPayload(encodedPayload);

  if (!signature) {
    return null;
  }

  return {
    actor: payload.actor,
    expiresAt: new Date(payload.exp).toISOString(),
    sessionToken: `${ADMIN_SESSION_TOKEN_PREFIX}${encodedPayload}.${signature}`,
    ttlSeconds: Math.floor((payload.exp - payload.iat) / 1000)
  };
};

const verifyAdminSession = (
  candidate: string,
  now = Date.now()
): AdminSessionPayload | null => {
  if (!candidate.startsWith(ADMIN_SESSION_TOKEN_PREFIX)) {
    return null;
  }

  const token = candidate.slice(ADMIN_SESSION_TOKEN_PREFIX.length);
  const [encodedPayload, signature] = token.split('.', 2);
  if (!encodedPayload || !signature) {
    return null;
  }

  if (!adminSessionSignatureMatches(encodedPayload, signature)) {
    return null;
  }

  let payload: AdminSessionPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as AdminSessionPayload;
  } catch {
    return null;
  }

  if (
    payload.v !== 1 ||
    payload.actor !== 'funding-admin-session' ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= now
  ) {
    return null;
  }

  return payload;
};

const resolveAdminAuthorization = (
  request: ApiRequest
): AdminAuthorization | null => {
  if (!adminToken) {
    return isProduction
      ? null
      : {
          actor: 'local-dev-admin',
          source: 'local-dev'
        };
  }

  const token = readAdminToken(request);
  if (!token) {
    return null;
  }

  if (verifyAdminSession(token)) {
    return {
      actor: 'funding-admin-session',
      source: 'session'
    };
  }

  if (adminTokenMatches(token)) {
    return {
      actor: 'funding-admin-token',
      source: 'static-token'
    };
  }

  return null;
};

const isAdminAuthorized = (request: ApiRequest): boolean => {
  return Boolean(resolveAdminAuthorization(request));
};

const ensureAdminAuthorization = (
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

  return true;
};

const ensureAdminAccess = (
  request: ApiRequest,
  response: ApiResponse
): boolean => {
  if (!ensureAdminAuthorization(request, response)) {
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

const getAdminAuditActor = (request: ApiRequest): string =>
  resolveAdminAuthorization(request)?.actor ?? 'local-dev-admin';

const resolveCheckoutReturnUrl = (
  candidateUrl: string,
  fallbackPath: string
): string => {
  const fallback = new URL(fallbackPath, publicBaseOrigin);

  try {
    const candidate = new URL(candidateUrl);
    const allowedOriginSet = new Set([...allowedOrigins, publicBaseOrigin]);

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
): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

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
      '/admin/session',
      '/api/admin/session',
      '/admin/setup-status',
      '/api/admin/setup-status',
      '/admin/email/test',
      '/api/admin/email/test',
      '/admin/dashboard',
      '/api/admin/dashboard',
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
      '/admin/publication-batches/cancel',
      '/api/admin/publication-batches/cancel',
      '/admin/audit-log',
      '/api/admin/audit-log',
      '/admin/sponsorships',
      '/api/admin/sponsorships',
      '/admin/sponsorships/logo',
      '/api/admin/sponsorships/logo',
      '/admin/sponsorships/logo/delete',
      '/api/admin/sponsorships/logo/delete',
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

const buildAdminSetupStatus = async (): Promise<AdminSetupStatusResponse> => {
  const databaseReachable = await getDatabaseConnectionStatus();
  let emailQueueStatus = {
    queuedCount: 0,
    sendingCount: 0,
    sentCount: 0,
    failedCount: 0,
    lastFailedAt: null as string | null,
    lastError: null as string | null
  };
  let emailQueueStatusError: string | null = null;
  const invoiceIssuerName =
    process.env.FUNDING_INVOICE_ISSUER_NAME?.trim() || 'OpenG7';
  const invoiceIssuerEmail =
    process.env.FUNDING_INVOICE_ISSUER_EMAIL?.trim() ||
    process.env.FUNDING_EMAIL_REPLY_TO?.trim() ||
    process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() ||
    null;

  try {
    emailQueueStatus = await getEmailQueueStatus(dbPool);
  } catch (error) {
    console.error('Failed to inspect email queue status.', error);
    emailQueueStatusError =
      'Email queue status could not be loaded. Apply migration 010.';
  }

  return {
    data_source: hasDatabase ? 'database' : stripe ? 'stripe_direct' : 'empty',
    environment: process.env.FUNDING_PLATFORM_ENV ?? 'development',
    public_base_url: publicBaseUrl ?? null,
    allowed_origins: allowedOrigins,
    stripe: {
      secret_key_configured: Boolean(stripeSecretKey),
      webhook_secret_configured: Boolean(stripeWebhookSecret),
      business_sponsorship_enabled: businessSponsorshipEnabled,
      dashboard_url: stripeSecretKey?.startsWith('sk_live_')
        ? 'https://dashboard.stripe.com/webhooks'
        : 'https://dashboard.stripe.com/test/webhooks',
      webhook_endpoint: `${publicBaseUrl ?? publicBaseOrigin}/api/stripe/webhook`
    },
    email: {
      resend_api_key_configured: Boolean(process.env.RESEND_API_KEY?.trim()),
      from: process.env.FUNDING_EMAIL_FROM?.trim() || null,
      reply_to: process.env.FUNDING_EMAIL_REPLY_TO?.trim() || null,
      admin_notification_email:
        process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() || null,
      queue_available: Boolean(dbPool && databaseReachable),
      queue_poll_interval_ms: emailQueuePollIntervalMs,
      queue_batch_size: emailQueueBatchSize,
      queued_count: emailQueueStatus.queuedCount,
      sending_count: emailQueueStatus.sendingCount,
      sent_count: emailQueueStatus.sentCount,
      failed_count: emailQueueStatus.failedCount,
      last_failed_at: emailQueueStatus.lastFailedAt,
      last_error: emailQueueStatus.lastError ?? emailQueueStatusError
    },
    invoice: {
      prefix:
        process.env.FUNDING_SPONSORSHIP_INVOICE_PREFIX?.trim() || 'OG7-CMD',
      issuer_name: invoiceIssuerName || null,
      issuer_email: invoiceIssuerEmail,
      issuer_address_configured: Boolean(
        process.env.FUNDING_INVOICE_ISSUER_ADDRESS?.trim()
      ),
      issuer_tax_id_configured: Boolean(
        process.env.FUNDING_INVOICE_TAX_ID?.trim()
      ),
      tax_label:
        process.env.FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL?.trim() ||
        'Taxes non calculees par la plateforme',
      ready: Boolean(invoiceIssuerName && invoiceIssuerEmail)
    },
    database: {
      configured: hasDatabase,
      reachable: databaseReachable
    },
    last_updated_at: new Date().toISOString()
  };
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

const csvCell = (value: string | number | boolean | null): string => {
  const text = value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const buildAdminContributionsCsv = (
  contributions: readonly AdminContributionRecord[]
): string => {
  const header = [
    'id',
    'public_reference',
    'contribution_type',
    'payment_status',
    'amount',
    'currency',
    'paid_at',
    'public_name',
    'email_private',
    'public_display_consent',
    'display_amount_consent',
    'sponsor_company_name',
    'sponsor_contact_name',
    'sponsor_contact_email',
    'sponsor_review_status',
    'sponsor_feed_status',
    'stripe_session_id',
    'stripe_payment_intent_id',
    'created_at',
    'updated_at'
  ];

  const rows = contributions.map((contribution) =>
    [
      contribution.id,
      contribution.public_reference,
      contribution.contribution_type,
      contribution.payment_status,
      contribution.amount,
      contribution.currency,
      contribution.paid_at,
      contribution.public_name,
      contribution.email_private,
      contribution.public_display_consent,
      contribution.display_amount_consent,
      contribution.sponsor_company_name,
      contribution.sponsor_contact_name,
      contribution.sponsor_contact_email,
      contribution.sponsor_review_status,
      contribution.sponsor_feed_status,
      contribution.stripe_session_id,
      contribution.stripe_payment_intent_id,
      contribution.created_at,
      contribution.updated_at
    ]
      .map(csvCell)
      .join(',')
  );

  return [header.join(','), ...rows].join('\n');
};

let emailQueueProcessing = false;

const runEmailQueueWorker = async (): Promise<void> => {
  if (!dbPool || emailQueueProcessing) {
    return;
  }

  emailQueueProcessing = true;
  try {
    const result = await processQueuedEmailMessages(dbPool, {
      limit: emailQueueBatchSize
    });

    if (result.sent > 0 || result.failed > 0) {
      console.info(
        `Email queue processed ${result.attempted} message(s): ${result.sent} sent, ${result.failed} failed.`
      );
    }
  } catch (error) {
    console.error('Failed to process email queue.', error);
  } finally {
    emailQueueProcessing = false;
  }
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
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/logo',
      '/api/admin/sponsorships/logo'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    const contributionId = new URL(
      request.url ?? '/',
      publicBaseOrigin
    ).searchParams.get('contributionId');

    if (!isValidUuid(contributionId)) {
      writeJson(request, response, 400, {
        error: 'Sponsor contribution id is invalid.'
      });
      return;
    }

    try {
      const logoUrl = await getAdminSponsorshipLogoUrl(dbPool, contributionId);
      const filename = getSponsorLogoFilenameFromUrl(logoUrl ?? undefined);

      if (!filename) {
        writeJson(request, response, 404, {
          error: 'Sponsor logo was not found.'
        });
        return;
      }

      const filePath = resolveSponsorLogoFilePath(filename);
      const contentType = contentTypeForSponsorLogoFilename(filename);

      if (!filePath || !contentType) {
        writeJson(request, response, 404, {
          error: 'Sponsor logo was not found.'
        });
        return;
      }

      const logo = await readFile(filePath);
      writeBinary(request, response, 200, logo, contentType, {
        'Cache-Control': 'private, no-store'
      });
    } catch (error) {
      console.error('Failed to load admin sponsor logo preview.', error);
      writeJson(request, response, 404, {
        error: 'Sponsor logo was not found.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/logo/delete',
      '/api/admin/sponsorships/logo/delete'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: Partial<AdminSponsorLogoDeleteRequest> | null;
    try {
      const body = await readBody(request, 16 * 1024);
      parsed = JSON.parse(
        body
      ) as Partial<AdminSponsorLogoDeleteRequest> | null;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsor logo delete request body.'
      });
      return;
    }

    const contributionId = parsed?.contributionId;
    const expectedVersion = parsed?.expectedVersion;

    if (!isValidUuid(contributionId)) {
      writeJson(request, response, 400, {
        error: 'Sponsor contribution id is invalid.'
      });
      return;
    }

    if (!isValidAdminExpectedVersion(expectedVersion)) {
      writeJson(request, response, 400, {
        error: 'Sponsor version is required.'
      });
      return;
    }

    try {
      const deleteResult = await clearSponsorshipLogoUrl(dbPool, {
        contributionId,
        expectedVersion
      });

      if (!deleteResult.updated) {
        writeSponsorshipMutationFailure(
          request,
          response,
          deleteResult.status,
          {
            currentVersion: deleteResult.currentVersion
          }
        );
        return;
      }

      const deletedLocalFile = await deleteControlledSponsorLogoFile(
        deleteResult.previousLogoUrl
      );

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'sponsorship.logo.delete',
        entityType: 'sponsorship',
        entityId: contributionId,
        summary: 'Sponsor logo removed from controlled public display.',
        metadata: {
          deletedLogoUrl: deleteResult.previousLogoUrl,
          deletedLocalFile
        }
      });

      const result: AdminSponsorLogoDeleteResult = {
        updated: deleteResult.updated,
        contributionId,
        deletedLogoUrl: deleteResult.previousLogoUrl
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to delete sponsor logo.', error);
      writeJson(request, response, 502, {
        error: 'Sponsor logo could not be deleted.'
      });
    }
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
    const isSponsorshipContribution =
      parsed.contributionType === 'sponsorship_interest';
    const isAmountAllowed = isSponsorshipContribution
      ? isValidSponsorshipAmount(amount)
      : allowedContributionAmounts.has(amount);

    if (!Number.isFinite(amount) || !isAmountAllowed) {
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

    if (isSponsorshipContribution && !businessSponsorshipEnabled) {
      writeJson(request, response, 403, {
        error: 'Business sponsorship checkout is disabled.'
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
      const requiresReview = parsed.contributionType === 'sponsorship_interest';
      const sponsorshipFollowupToken = requiresReview
        ? createSponsorshipFollowupToken()
        : null;
      const sponsorshipFollowupTokenHash = sponsorshipFollowupToken
        ? hashSponsorshipFollowupToken(sponsorshipFollowupToken)
        : null;
      const checkoutSuccessUrl = sponsorshipFollowupToken
        ? buildSponsorshipCheckoutSuccessUrl(
            successUrl,
            sponsorshipFollowupToken
          )
        : successUrl;
      const publicReference = createContributionPublicReference();
      const publicDisplayName =
        parsed.publicDisplayConsent === true &&
        typeof parsed.publicDisplayName === 'string'
          ? parsed.publicDisplayName.trim()
          : '';
      const checkoutMetadata: Record<string, string> = {
        projectId,
        project: 'openg7',
        program: 'builders_fund',
        publicReference,
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
        client_reference_id: publicReference,
        success_url: checkoutSuccessUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'cad',
              unit_amount: Math.round(amount * 100),
              product_data: {
                name: `OpenG7 ${projectId} - ${publicReference}`,
                description:
                  buildContributionReceiptDescription(publicReference)
              }
            }
          }
        ],
        payment_intent_data: {
          description: buildContributionReceiptDescription(publicReference),
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
          publicReference,
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
        error:
          'This checkout session is not a sponsorship interest contribution.'
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
        publicReference: normalizeContributionPublicReference(
          sessionMetadata.publicReference
        ),
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

    const token = new URL(
      request.url ?? '/',
      publicBaseOrigin
    ).searchParams.get('token');
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
        publicReference: followup.publicReference,
        reviewStatus: followup.reviewStatus,
        amount: followup.amount,
        currency: followup.currency,
        paidAt: followup.paidAt,
        sponsorshipTier: followup.sponsorshipTier,
        sponsorshipBenefits: followup.sponsorshipBenefits,
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
      '/admin/sponsorships/logo',
      '/api/admin/sponsorships/logo'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    const boundary = parseMultipartBoundary(request.headers['content-type']);
    if (!boundary) {
      writeJson(request, response, 400, {
        error: 'Sponsor logo upload must use multipart/form-data.'
      });
      return;
    }

    let parts: readonly MultipartPart[];
    try {
      const body = await readBodyBuffer(
        request,
        sponsorLogoMaxBytes + 64 * 1024
      );
      parts = parseMultipartFormData(body, boundary);
    } catch {
      writeJson(request, response, 413, {
        error: 'Sponsor logo upload is too large.'
      });
      return;
    }

    const contributionId =
      parts
        .find((part) => part.name === 'contributionId')
        ?.data.toString('utf8')
        .trim() ?? '';
    const expectedVersion =
      parts
        .find((part) => part.name === 'expectedVersion')
        ?.data.toString('utf8')
        .trim() ?? '';

    if (!isValidUuid(contributionId)) {
      writeJson(request, response, 400, {
        error: 'Sponsor contribution id is invalid.'
      });
      return;
    }

    if (!isValidAdminExpectedVersion(expectedVersion)) {
      writeJson(request, response, 400, {
        error: 'Sponsor version is required.'
      });
      return;
    }

    const logo = parseSponsorLogoUpload(parts, contributionId);
    if (!logo) {
      writeJson(request, response, 400, {
        error: 'Sponsor logo must be a valid PNG, JPEG, or WebP image.'
      });
      return;
    }

    const filePath = resolveSponsorLogoFilePath(logo.filename);
    if (!filePath) {
      writeJson(request, response, 400, {
        error: 'Sponsor logo filename is invalid.'
      });
      return;
    }

    const logoUrl = sponsorLogoPublicUrlForFilename(logo.filename);

    try {
      await mkdir(sponsorLogoStorageDir, { recursive: true });
      await writeFile(filePath, logo.data, { flag: 'wx' });

      const updateResult = await updateSponsorshipLogoUrl(dbPool, {
        contributionId,
        logoUrl,
        expectedVersion
      });

      if (!updateResult.updated) {
        await unlink(filePath).catch(() => undefined);
        writeSponsorshipMutationFailure(
          request,
          response,
          updateResult.status,
          {
            currentVersion: updateResult.currentVersion
          }
        );
        return;
      }

      const replacedLocalFile = await deleteControlledSponsorLogoFile(
        updateResult.previousLogoUrl
      );

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'sponsorship.logo.upload',
        entityType: 'sponsorship',
        entityId: contributionId,
        summary: 'Sponsor logo uploaded for controlled public display.',
        metadata: {
          logoUrl,
          previousLogoUrl: updateResult.previousLogoUrl,
          replacedLocalFile,
          mimeType: logo.mimeType,
          sizeBytes: logo.sizeBytes
        }
      });

      const result: AdminSponsorLogoUploadResult = {
        updated: updateResult.updated,
        contributionId,
        logoUrl,
        mimeType: logo.mimeType,
        sizeBytes: logo.sizeBytes
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to upload sponsor logo.', error);
      writeJson(request, response, 502, {
        error: 'Sponsor logo could not be uploaded.'
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
                    sponsorWebsiteUrl: truncateStripeMetadataValue(websiteUrl)
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
    request.method === 'POST' &&
    routeMatches(request.url, '/admin/session', '/api/admin/session')
  ) {
    if (!adminToken && isProduction) {
      writeJson(request, response, 503, {
        error: 'Admin session is not configured.'
      });
      return;
    }

    let parsed: AdminSessionCreateRequest;
    try {
      const body = await readBody(request, 16 * 1024);
      parsed = JSON.parse(body) as AdminSessionCreateRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid admin session request body.'
      });
      return;
    }

    const suppliedToken =
      typeof parsed.token === 'string' ? parsed.token.trim() : '';
    if (adminToken && !adminTokenMatches(suppliedToken)) {
      writeJson(request, response, 401, {
        error: 'Admin authorization is required.'
      });
      return;
    }

    const session = createAdminSession();
    if (!session) {
      writeJson(request, response, 503, {
        error: 'Admin session signing is not configured.'
      });
      return;
    }

    writeJson(request, response, 200, session);
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(request.url, '/admin/setup-status', '/api/admin/setup-status')
  ) {
    if (!ensureAdminAuthorization(request, response)) {
      return;
    }

    try {
      const setupStatus = await buildAdminSetupStatus();
      writeJson(request, response, 200, setupStatus);
    } catch (error) {
      console.error('Failed to load admin setup status.', error);
      writeJson(request, response, 502, {
        error: 'Admin setup status could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(request.url, '/admin/email/test', '/api/admin/email/test')
  ) {
    if (!ensureAdminAuthorization(request, response)) {
      return;
    }

    if (!dbPool) {
      writeJson(request, response, 503, {
        error: 'Email test requires DATABASE_URL and migration 010.'
      });
      return;
    }

    if (
      !process.env.RESEND_API_KEY?.trim() ||
      !process.env.FUNDING_EMAIL_FROM?.trim()
    ) {
      writeJson(request, response, 400, {
        error: 'Email provider is not configured.'
      });
      return;
    }

    let parsed: AdminEmailTestRequest = {};
    try {
      const body = await readBody(request, 16 * 1024);
      parsed = body.trim() ? (JSON.parse(body) as AdminEmailTestRequest) : {};
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid email test request body.'
      });
      return;
    }

    const recipient =
      typeof parsed.to === 'string' && parsed.to.trim()
        ? parsed.to.trim()
        : (process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() ?? '');

    if (!isValidSponsorEmail(recipient)) {
      writeJson(request, response, 400, {
        error: 'A valid test email is required.'
      });
      return;
    }

    try {
      const result = await queueEmailConfigurationTest(dbPool, {
        to: recipient,
        idempotencyKey: `admin-email-test:${Date.now()}:${randomBytes(6).toString('hex')}`
      });
      const payload: AdminEmailTestResult = {
        queued: result.queued,
        attempted: result.attempted,
        sent: result.sent,
        messageId: result.messageId,
        error: result.error
      };
      writeJson(request, response, 200, payload);
    } catch (error) {
      console.error('Failed to send admin email test.', error);
      writeJson(request, response, 502, {
        error: 'Admin email test could not be queued.'
      });
    }
    return;
  }

  if (request.method === 'GET') {
    const filename = getSponsorLogoFilenameFromUrl(request.url);
    if (filename) {
      if (!hasDatabase) {
        writeJson(request, response, 404, { error: 'Not found' });
        return;
      }

      const filePath = resolveSponsorLogoFilePath(filename);
      const contentType = contentTypeForSponsorLogoFilename(filename);
      const publicLogoUrl = sponsorLogoPublicUrlForFilename(filename);

      if (!filePath || !contentType) {
        writeJson(request, response, 404, { error: 'Not found' });
        return;
      }

      try {
        const isAllowed = await isPublicApprovedSponsorshipLogoUrl(
          dbPool,
          publicLogoUrl
        );

        if (!isAllowed) {
          writeJson(request, response, 404, { error: 'Not found' });
          return;
        }

        const logo = await readFile(filePath);
        writeBinary(request, response, 200, logo, contentType, {
          'Cache-Control': 'public, max-age=86400'
        });
      } catch (error) {
        console.error('Failed to serve sponsor logo.', error);
        writeJson(request, response, 404, { error: 'Not found' });
      }
      return;
    }
  }

  if (
    request.method === 'GET' &&
    routeMatches(request.url, '/admin/dashboard', '/api/admin/dashboard')
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const result = await getAdminDashboard(dbPool);
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load admin dashboard.', error);
      writeJson(request, response, 502, {
        error: 'Admin dashboard could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/contributions',
      '/api/admin/contributions'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const result = await listAdminContributions(dbPool);
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load admin contributions.', error);
      writeJson(request, response, 502, {
        error: 'Admin contributions could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/contributions.csv',
      '/api/admin/contributions.csv'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const result = await listAdminContributions(dbPool);
      writeCsv(
        request,
        response,
        200,
        buildAdminContributionsCsv(result.contributions),
        'openg7-admin-contributions.csv'
      );
    } catch (error) {
      console.error('Failed to export admin contributions.', error);
      writeJson(request, response, 502, {
        error: 'Admin contributions export could not be generated.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(request.url, '/admin/expenses', '/api/admin/expenses')
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const result = await listAdminExpenses(dbPool);
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load admin expenses.', error);
      writeJson(request, response, 502, {
        error: 'Admin expenses could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(request.url, '/admin/expenses', '/api/admin/expenses')
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminExpenseCreateRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminExpenseCreateRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid expense request body.'
      });
      return;
    }

    if (
      !isNonEmptySponsorText(parsed.projectName, ADMIN_EXPENSE_NAME_MAX_LENGTH)
    ) {
      writeJson(request, response, 400, {
        error: 'Expense project name is invalid.'
      });
      return;
    }

    if (
      !isNonEmptySponsorText(
        parsed.publicDescription,
        ADMIN_EXPENSE_DESCRIPTION_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Expense public description is invalid.'
      });
      return;
    }

    if (
      !Number.isFinite(parsed.amountAllocated) ||
      parsed.amountAllocated <= 0
    ) {
      writeJson(request, response, 400, {
        error: 'Expense amount must be positive.'
      });
      return;
    }

    if (parsed.currency !== 'CAD') {
      writeJson(request, response, 400, {
        error: 'Expense currency is not supported.'
      });
      return;
    }

    if (!isAllowedAdminExpenseStatus(parsed.status)) {
      writeJson(request, response, 400, {
        error: 'Expense status is invalid.'
      });
      return;
    }

    if (!isValidOptionalIsoDate(parsed.publishedAt)) {
      writeJson(request, response, 400, {
        error: 'Expense published date is invalid.'
      });
      return;
    }

    try {
      const result = await createAdminExpense(dbPool, parsed);
      if (!result.updated || !result.expense) {
        writeJson(request, response, 404, {
          error: 'Expense could not be created or fund_allocations is missing.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'expense.create',
        entityType: 'expense',
        entityId: result.expense.id,
        summary: `Expense created for ${result.expense.project_name}.`,
        metadata: {
          amountAllocated: result.expense.amount_allocated,
          status: result.expense.status
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to create admin expense.', error);
      writeJson(request, response, 502, {
        error: 'Admin expense could not be created.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/expenses/update',
      '/api/admin/expenses/update'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminExpenseUpdateRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminExpenseUpdateRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid expense update request body.'
      });
      return;
    }

    if (!isValidAdminExpenseId(parsed.expenseId)) {
      writeJson(request, response, 400, {
        error: 'Invalid expense id.'
      });
      return;
    }

    if (
      !isValidOptionalNonEmptyBoundedText(
        parsed.projectName,
        ADMIN_EXPENSE_NAME_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Expense project name is invalid.'
      });
      return;
    }

    if (
      !isValidOptionalNonEmptyBoundedText(
        parsed.publicDescription,
        ADMIN_EXPENSE_DESCRIPTION_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Expense public description is invalid.'
      });
      return;
    }

    if (
      parsed.amountAllocated !== undefined &&
      (!Number.isFinite(parsed.amountAllocated) || parsed.amountAllocated <= 0)
    ) {
      writeJson(request, response, 400, {
        error: 'Expense amount must be positive.'
      });
      return;
    }

    if (parsed.currency !== undefined && parsed.currency !== 'CAD') {
      writeJson(request, response, 400, {
        error: 'Expense currency is not supported.'
      });
      return;
    }

    if (
      parsed.status !== undefined &&
      !isAllowedAdminExpenseStatus(parsed.status)
    ) {
      writeJson(request, response, 400, {
        error: 'Expense status is invalid.'
      });
      return;
    }

    if (!isValidOptionalIsoDate(parsed.publishedAt)) {
      writeJson(request, response, 400, {
        error: 'Expense published date is invalid.'
      });
      return;
    }

    try {
      const result = await updateAdminExpense(dbPool, parsed);
      if (!result.updated || !result.expense) {
        writeJson(request, response, 404, {
          error: 'Expense was not found.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: parsed.status ? `expense.${parsed.status}` : 'expense.update',
        entityType: 'expense',
        entityId: result.expense.id,
        summary: `Expense updated for ${result.expense.project_name}.`,
        metadata: {
          amountAllocated: result.expense.amount_allocated,
          status: result.expense.status
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to update admin expense.', error);
      writeJson(request, response, 502, {
        error: 'Admin expense could not be updated.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(request.url, '/admin/transparency', '/api/admin/transparency')
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const [publicSummary, expenses] = await Promise.all([
        getPublicTransparencySummary(dbPool),
        listAdminExpenses(dbPool)
      ]);
      const lastUpdatedAt =
        new Date(publicSummary.last_updated_at).getTime() >
        new Date(expenses.last_updated_at).getTime()
          ? publicSummary.last_updated_at
          : expenses.last_updated_at;
      const result: AdminTransparencyResponse = {
        data_source: 'database',
        public_summary: publicSummary,
        expenses_summary: expenses.summary,
        expenses: expenses.expenses,
        last_updated_at: lastUpdatedAt
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load admin transparency.', error);
      writeJson(request, response, 502, {
        error: 'Admin transparency could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/publication-drafts',
      '/api/admin/publication-drafts'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const result = await listAdminPublicationDrafts(dbPool);
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load publication drafts.', error);
      writeJson(request, response, 502, {
        error: 'Publication drafts could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-drafts',
      '/api/admin/publication-drafts'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationDraftCreateRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationDraftCreateRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication draft request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.contributionId)) {
      writeJson(request, response, 400, {
        error: 'Invalid contribution id.'
      });
      return;
    }

    if (parsed.feedTarget !== 'openg7' && parsed.feedTarget !== 'openg20') {
      writeJson(request, response, 400, {
        error: 'Invalid publication draft feed target.'
      });
      return;
    }

    if (!isAllowedSponsorFeedChannel(parsed.channel)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication draft channel.'
      });
      return;
    }

    try {
      const result = await createAdminPublicationDraft(dbPool, parsed);
      if (!result.updated || !result.draft) {
        writeJson(request, response, 404, {
          error:
            'Approved sponsorship was not found or publication drafts migration is missing.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_draft.create',
        entityType: 'publication_draft',
        entityId: result.draft.id,
        summary: `Publication draft created for ${result.draft.sponsor_company_name}.`,
        metadata: {
          contributionId: result.draft.contribution_id,
          feedTarget: result.draft.feed_target,
          channel: result.draft.channel
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to create publication draft.', error);
      writeJson(request, response, 502, {
        error: 'Publication draft could not be created.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-drafts/update',
      '/api/admin/publication-drafts/update'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationDraftUpdateRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationDraftUpdateRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication draft update request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.draftId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication draft id.'
      });
      return;
    }

    if (
      !isValidOptionalNonEmptyBoundedText(
        parsed.title,
        PUBLICATION_DRAFT_TITLE_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Publication draft title is invalid.'
      });
      return;
    }

    if (
      !isValidOptionalNonEmptyBoundedText(
        parsed.body,
        PUBLICATION_DRAFT_BODY_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Publication draft body is invalid.'
      });
      return;
    }

    if (
      !isValidOptionalNonEmptyBoundedText(
        parsed.disclosureText,
        PUBLICATION_DRAFT_DISCLOSURE_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Publication draft disclosure is invalid.'
      });
      return;
    }

    if (
      parsed.status !== undefined &&
      !isAllowedPublicationDraftStatus(parsed.status)
    ) {
      writeJson(request, response, 400, {
        error: 'Invalid publication draft status.'
      });
      return;
    }

    if (!isValidOptionalHttpsUrl(parsed.publicUrl)) {
      writeJson(request, response, 400, {
        error: 'Publication public URL must be a valid https link.'
      });
      return;
    }

    if (!isValidOptionalIsoDate(parsed.scheduledAt)) {
      writeJson(request, response, 400, {
        error: 'Publication scheduled date is invalid.'
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
        error: 'Publication draft review note is too long.'
      });
      return;
    }

    try {
      const result = await updateAdminPublicationDraft(dbPool, parsed);
      if (!result.updated || !result.draft) {
        writeJson(request, response, 404, {
          error: 'Publication draft was not found.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: parsed.status
          ? `publication_draft.${parsed.status}`
          : 'publication_draft.update',
        entityType: 'publication_draft',
        entityId: result.draft.id,
        summary: `Publication draft updated for ${result.draft.sponsor_company_name}.`,
        metadata: {
          status: result.draft.status,
          contributionId: result.draft.contribution_id,
          feedTarget: result.draft.feed_target,
          channel: result.draft.channel
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to update publication draft.', error);
      writeJson(request, response, 502, {
        error: 'Publication draft could not be updated.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/publication-batches',
      '/api/admin/publication-batches'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const result = await listAdminPublicationBatches(dbPool);
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load publication batches.', error);
      writeJson(request, response, 502, {
        error: 'Publication batches could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-batches',
      '/api/admin/publication-batches'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationBatchCreateRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationBatchCreateRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch request body.'
      });
      return;
    }

    if (!isAllowedSponsorFeedChannel(parsed.channel)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch channel.'
      });
      return;
    }

    if (!isValidPublicationBatchCapacity(parsed.capacity)) {
      writeJson(request, response, 400, {
        error: `Publication batch capacity must be an integer between ${PUBLICATION_BATCH_MIN_CAPACITY} and ${PUBLICATION_BATCH_MAX_CAPACITY}.`
      });
      return;
    }

    if (
      !isValidOptionalBoundedText(
        parsed.notes,
        PUBLICATION_BATCH_NOTES_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Publication batch notes are too long.'
      });
      return;
    }

    try {
      const result = await createAdminPublicationBatch(dbPool, parsed);
      if (!result.updated || !result.batch) {
        writeJson(request, response, 404, {
          error: 'Publication batches migration is missing.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_batch.create',
        entityType: 'publication_batch',
        entityId: result.batch.id,
        summary: `Publication batch created for ${channelLabel(result.batch.channel)} (capacity ${result.batch.capacity}).`,
        metadata: {
          channel: result.batch.channel,
          capacity: result.batch.capacity
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to create publication batch.', error);
      writeJson(request, response, 502, {
        error: 'Publication batch could not be created.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-batches/assign',
      '/api/admin/publication-batches/assign'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationBatchAssignRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationBatchAssignRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch assignment request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.batchId) || !isValidUuid(parsed.draftId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch or draft id.'
      });
      return;
    }

    try {
      const result = await assignDraftToPublicationBatch(dbPool, parsed);
      if (!result.updated || !result.draft) {
        writeJson(request, response, 409, {
          error:
            'Draft could not be assigned: it must be approved, match the batch channel, and the batch must be open with available capacity.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_batch.assign',
        entityType: 'publication_batch',
        entityId: parsed.batchId,
        summary: `Draft for ${result.draft.sponsor_company_name} assigned to batch.`,
        metadata: { draftId: parsed.draftId, batchId: parsed.batchId }
      });

      const batch = await getPublicationBatchById(dbPool, parsed.batchId);
      if (batch && batch.status === 'open' && batch.capacityAvailable === 0) {
        const notificationResult = await queuePublicationBatchFullNotification(
          dbPool,
          {
            batchId: batch.id,
            idempotencyKey: `publication-batch:${batch.id}:full`,
            channel: batch.channel,
            capacity: batch.capacity
          }
        );
        if (!notificationResult.queued && !notificationResult.sent) {
          console.warn(
            'Publication batch is full but the admin notification could not be sent.',
            notificationResult.error
          );
        }
      }

      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to assign draft to publication batch.', error);
      writeJson(request, response, 502, {
        error: 'Draft could not be assigned to the publication batch.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-batches/unassign',
      '/api/admin/publication-batches/unassign'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationBatchUnassignRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationBatchUnassignRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch unassignment request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.draftId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication draft id.'
      });
      return;
    }

    try {
      const result = await unassignDraftFromPublicationBatch(dbPool, parsed);
      if (!result.updated || !result.draft) {
        writeJson(request, response, 404, {
          error: 'Draft is not assigned to a batch, or is already published.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_batch.unassign',
        entityType: 'publication_draft',
        entityId: result.draft.id,
        summary: `Draft for ${result.draft.sponsor_company_name} removed from batch.`,
        metadata: { draftId: parsed.draftId }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to unassign draft from publication batch.', error);
      writeJson(request, response, 502, {
        error: 'Draft could not be removed from the publication batch.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-batches/schedule',
      '/api/admin/publication-batches/schedule'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationBatchScheduleRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationBatchScheduleRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch schedule request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.batchId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch id.'
      });
      return;
    }

    if (
      typeof parsed.scheduledAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.scheduledAt))
    ) {
      writeJson(request, response, 400, {
        error: 'Publication batch scheduled date is invalid.'
      });
      return;
    }

    try {
      const result = await scheduleAdminPublicationBatch(dbPool, parsed);
      if (!result.updated || !result.batch) {
        writeJson(request, response, 409, {
          error: 'Publication batch was not found or cannot be scheduled.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_batch.schedule',
        entityType: 'publication_batch',
        entityId: result.batch.id,
        summary: `Publication batch scheduled for ${result.batch.scheduledAt}.`,
        metadata: {
          channel: result.batch.channel,
          scheduledAt: result.batch.scheduledAt
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to schedule publication batch.', error);
      writeJson(request, response, 502, {
        error: 'Publication batch could not be scheduled.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-batches/publish',
      '/api/admin/publication-batches/publish'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationBatchLifecycleRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationBatchLifecycleRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.batchId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch id.'
      });
      return;
    }

    try {
      const result = await publishAdminPublicationBatch(dbPool, parsed);
      if (!result.updated || !result.batch) {
        writeJson(request, response, 409, {
          error:
            'Publication batch was not found or must be scheduled before it can be published.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_batch.publish',
        entityType: 'publication_batch',
        entityId: result.batch.id,
        summary: `Publication batch published (${result.batch.assignedDraftIds.length} sponsor(s)).`,
        metadata: {
          channel: result.batch.channel,
          assignedDraftIds: result.batch.assignedDraftIds
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to publish publication batch.', error);
      writeJson(request, response, 502, {
        error: 'Publication batch could not be published.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-batches/cancel',
      '/api/admin/publication-batches/cancel'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationBatchLifecycleRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationBatchLifecycleRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.batchId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication batch id.'
      });
      return;
    }

    try {
      const result = await cancelAdminPublicationBatch(dbPool, parsed);
      if (!result.updated || !result.batch) {
        writeJson(request, response, 409, {
          error: 'Publication batch was not found or is already final.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_batch.cancel',
        entityType: 'publication_batch',
        entityId: result.batch.id,
        summary: `Publication batch cancelled (${channelLabel(result.batch.channel)}).`,
        metadata: { channel: result.batch.channel }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to cancel publication batch.', error);
      writeJson(request, response, 502, {
        error: 'Publication batch could not be cancelled.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(request.url, '/admin/audit-log', '/api/admin/audit-log')
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const result = await listAdminAuditLog(dbPool);
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load admin audit log.', error);
      writeJson(request, response, 502, {
        error: 'Admin audit log could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(request.url, '/admin/sponsorships', '/api/admin/sponsorships')
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const sponsorships = await listAdminSponsorships(
        dbPool,
        parseAdminSponsorshipsQuery(request.url)
      );
      const result: AdminSponsorshipsResponse = {
        data_source: 'database',
        items: sponsorships.items,
        sponsorships: sponsorships.items,
        pagination: sponsorships.pagination,
        last_updated_at: sponsorships.lastUpdatedAt
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

    if (!isValidAdminExpectedVersion(parsed.expectedVersion)) {
      writeJson(request, response, 400, {
        error: 'Sponsorship version is required.'
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
            : null,
        expectedVersion: parsed.expectedVersion
      });

      if (!updated.updated) {
        writeSponsorshipMutationFailure(request, response, updated.status, {
          currentVersion: updated.currentVersion,
          paymentStatus: updated.paymentStatus
        });
        return;
      }

      const result: AdminSponsorshipReviewResult = {
        updated: updated.updated,
        reviewStatus: parsed.reviewStatus
      };
      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: `sponsorship_review.${parsed.reviewStatus}`,
        entityType: 'sponsorship',
        entityId: parsed.contributionId,
        summary: `Sponsorship review set to ${parsed.reviewStatus}.`,
        metadata: {
          reviewStatus: parsed.reviewStatus,
          hasReviewNote: Boolean(parsed.reviewNote?.trim())
        }
      });
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

    if (!isValidAdminExpectedVersion(parsed.expectedVersion)) {
      writeJson(request, response, 400, {
        error: 'Sponsorship version is required.'
      });
      return;
    }

    try {
      const publicationUpdate = await updateSponsorshipPublication(dbPool, {
        contributionId: parsed.contributionId,
        expectedVersion: parsed.expectedVersion,
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

      if (!publicationUpdate.updated) {
        writeSponsorshipMutationFailure(
          request,
          response,
          publicationUpdate.status,
          {
            currentVersion: publicationUpdate.currentVersion,
            paymentStatus: publicationUpdate.paymentStatus
          }
        );
        return;
      }

      const result: AdminSponsorshipPublicationResult = {
        updated: publicationUpdate.updated,
        feedStatus: parsed.feedStatus
      };
      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'sponsorship_publication.update',
        entityType: 'sponsorship',
        entityId: parsed.contributionId,
        summary: `Sponsorship publication metadata updated to ${parsed.feedStatus}.`,
        metadata: {
          feedTarget: parsed.feedTarget ?? null,
          feedChannels: publicationUpdate.feedChannels,
          feedStatus: parsed.feedStatus,
          hasPublicUrl: Boolean(parsed.feedPublicUrl?.trim())
        }
      });
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
      '/public/sponsorship-batches/availability',
      '/api/public/sponsorship-batches/availability'
    )
  ) {
    try {
      const availability = await getPublicSponsorshipBatchAvailability(dbPool);

      writeJson(request, response, 200, availability);
    } catch (error) {
      console.error(
        'Failed to load public sponsorship batch availability.',
        error
      );
      writeJson(request, response, 502, {
        error: 'Sponsorship batch availability could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/public/funding-config',
      '/api/public/funding-config'
    )
  ) {
    const runtimeConfig: PublicFundingRuntimeConfig = {
      business_sponsorship_enabled: businessSponsorshipEnabled,
      last_updated_at: new Date().toISOString()
    };
    writeJson(request, response, 200, runtimeConfig);
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
      businessSponsorshipEnabled,
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
    return;
  }

  void runEmailQueueWorker();
  const emailQueueTimer = setInterval(
    () => void runEmailQueueWorker(),
    emailQueuePollIntervalMs
  );
  emailQueueTimer.unref();
});
