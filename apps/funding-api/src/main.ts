import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PublicationAutomationCommand } from '@openg7/funding-core';
import Stripe from 'stripe';
import type {
  AdminAssistantDraftType,
  AdminAssistantPrepareRequest,
  AdminAssistantQueryRequest,
  AdminSetupStatusResponse,
  AdminPublicationBatchAssignRequest,
  AdminPublicationBatchCreateRequest,
  AdminPublicationBatchLifecycleRequest,
  AdminPublicationBatchScheduleRequest,
  AdminPublicationBatchUnassignRequest,
  AdminPublicationDraftCreateRequest,
  AdminPublicationDraftUpdateRequest,
  AdminPublicationSlotAssignBatchRequest,
  AdminPublicationSlotAssignDraftRequest,
  AdminPublicationSlotCreateRequest,
  AdminPublicationSlotLifecycleRequest,
  AdminPublicationSlotUpdateRequest,
  AdminSessionCreateRequest,
  AdminSponsorMediaDeleteRequest,
  AdminSponsorMediaReviewRequest,
  AdminSponsorMediaReviewResult,
  AdminSponsorLogoDeleteRequest,
  AdminSponsorLogoDeleteResult,
  AdminSponsorLogoUploadResult,
  AdminSponsorshipStripeRefundReason,
  AdminSponsorshipRejectionRefundHandling,
  AdminSponsorshipPublicationRequest,
  AdminSponsorshipPublicationResult,
  AdminSponsorshipRefundRequest,
  AdminSponsorshipRefundResult,
  AdminSponsorshipReviewRequest,
  AdminSponsorshipReviewResult,
  AdminSponsorshipsResponse,
  ContributionType,
  CheckoutResult,
  CheckoutRequest,
  PublicFundingRuntimeConfig,
  PublicReferenceLookupRequest,
  PublicReferenceLookupResponse,
  ReferenceRecoveryRequest,
  ReferenceRecoveryResult,
  RedirectCheckoutResult,
  SponsorMediaDeleteRequest,
  SponsorMediaDeleteResult,
  SponsorMediaKind,
  SponsorMediaUploadResult,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipDetailsRequest,
  SponsorshipDetailsResult,
  SponsorshipFollowupDetailsRequest,
  SponsorshipFollowupResponse,
  SponsorshipMediaResponse,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import {
  isValidSponsorshipAmount,
  isSafeSponsorshipText,
  isSponsorshipEmail,
  isSponsorshipHttpsUrl
} from '../../../packages/funding-core/src/index.js';

import {
  buildSponsorshipFollowupUrl,
  sponsorshipFollowupLocaleFromUrl
} from './sponsorship-followup-links.js';
import {
  BackupError,
  backupStatus,
  isBackupId,
  requestBackup
} from './database-backup/service.js';
import {
  AdminStripeBackfillService,
  AdminStripeBackfillError
} from './admin-stripe-backfill.service.js';
import {
  ContributionExportError,
  exportAdminContributions
} from './admin-contributions-export.service.js';
import {
  ContributionActivityService,
  contributionNotificationConfig
} from './contribution-activity.service.js';
import { simulatedCheckoutEnabled } from './stripe-checkout-config.js';
import {
  DocumentResendConflict,
  queueAdminDocumentResend
} from './admin-document-resend.service.js';
import { PublicationAutomationError } from './publication-automation/policy.js';
import { PublicationAutomationService } from './publication-automation/service.js';
import { AdminPilotageService, PilotError } from './admin-pilotage.service.js';
import { AdminIdentityService } from './admin-identity.js';
import {
  SponsorshipDetailsError,
  updateAdminSponsorshipDetails
} from './admin-sponsorship-details.service.js';
import {
  getSponsorshipInterventions,
  recordSponsorshipIntervention,
  SponsorshipInterventionError
} from './sponsorship-interventions.service.js';
import {
  allowedAdminExpenseStatuses,
  allowedPublicationDraftStatuses,
  assignDraftToPublicationBatch,
  assignBatchToPublicationSlot,
  assignDraftToPublicationSlot,
  cancelAdminPublicationBatch,
  cancelAdminPublicationSlot,
  createAdminExpense,
  AdminExpenseValidationError,
  createAdminPublicationBatch,
  createAdminPublicationDraft,
  createAdminPublicationSlot,
  getPublicationBatchById,
  getPublicSponsorshipBatchAvailability,
  insertAdminAuditLog,
  listAdminExpenses,
  listAdminAuditLog,
  listAdminPublicationBatches,
  listAdminPublicationDrafts,
  listAdminPublicationSlots,
  listAdminSocialPublicationJobs,
  publishAdminPublicationBatch,
  publishAdminPublicationSlot,
  scheduleAdminPublicationBatch,
  unassignDraftFromPublicationBatch,
  updateAdminExpense,
  updateAdminPublicationDraft,
  updateAdminPublicationSlot
} from './fund-admin.repository.js';
import { dbPool, hasDatabase } from './database.js';
import { createAdminContributionsHttpHandler } from './admin-contributions.http.js';
import { createAdminDocumentsHttpHandler } from './admin-documents.http.js';
import { createAdminAccountingHttpHandler } from './admin-accounting.http.js';
import { createAdminEmailHttpHandler } from './admin-email.http.js';
import { createAdminInsightsHttpHandler } from './admin-insights.http.js';
import {
  loadSponsorMediaLimits,
  SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES
} from './sponsor-media-limits.js';
import { loadTrustedProxyHops } from './request-client-ip.js';
import {
  SponsorshipAccessError,
  normalizeRecoveryEmail,
  recoverSponsorshipAccess,
  getSponsorshipAccessRecipient,
  issueSponsorshipAccess,
  getSponsorshipDraft,
  saveSponsorshipDraft,
  submitSponsorshipDraft
} from './sponsorship-access.service.js';
import { parseAdminSearch, searchAdmin } from './admin-search.service.js';
import {
  getAdminStripeEvent,
  validStripeEventId
} from './admin-stripe-event.service.js';
import { getCockpitMetrics } from './admin-cockpit/metrics.js';
import { getCockpitActivity } from './admin-cockpit/activity.js';
import {
  createCockpitSystemsReader,
  readSystemObservation
} from './admin-cockpit/systems.js';
import { readStripeConnection } from './admin-cockpit/stripe-connection.js';
import { readSnapshot } from './admin-cockpit/read.js';
import {
  getEmailQueueStatus,
  getAdminEmailQueueMessageById,
  listAdminEmailQueue,
  processQueuedEmailMessages,
  queueContributionReferenceRecoveryEmail,
  queueEmailConfigurationTest,
  getEmailConfigurationTest,
  isEmailTestRequestId,
  EmailConfigurationTestError,
  queuePublicationBatchFullNotification,
  queueSponsorshipCreditNoteEmail,
  queueSponsorshipRefundEmail,
  queueSponsorshipRejectionEmail,
  retryAdminEmailQueueMessage
} from './email-notification.service.js';
import {
  configuredSocialPublicationChannels,
  loadSocialPublicationConfig
} from './social-publication.service.js';
import {
  getTransactionalEmailConfigStatus,
  isValidEmailAddress,
  loadEmailQueueWorkerEnabled,
  loadTransactionalEmailConfig
} from './services/email/index.js';
import {
  allowedSponsorFeedChannels,
  allowedSponsorFeedStatuses,
  allowedSponsorFeedTargets,
  clearSponsorshipLogoUrl,
  getAdminDashboard,
  getAdminSponsorshipById,
  getAdminSponsorshipLogoUrl,
  allowedSponsorshipReviewStatuses,
  insertCheckoutSessionRecord,
  getSponsorshipFollowupByTokenHash,
  isPublicApprovedSponsorshipLogoUrl,
  lookupPublicContributionReference,
  listContributionReferencesByEmail,
  listPublicSponsorships,
  listAdminContributions,
  listAdminSponsorships,
  normalizeContributionType,
  parseMetadataBoolean,
  recordSponsorshipDetails,
  updateSponsorshipLogoUrl,
  updateSponsorshipPublication,
  updateSponsorshipRefundWorkflowStatus,
  updateSponsorshipReview,
  getSponsorshipRefundTarget,
  updateContributionStatusByPaymentIntent,
  upsertCheckoutSessionFromWebhook,
  type SponsorshipFollowupLookup
} from './fund-contributions.repository.js';
import {
  getPublicTransparencySummary,
  listPublicBuilders
} from './fund-transparency.repository.js';
import { parsePublicDirectoryPagination } from './public-directory-pagination.js';
import { parsePublicSponsorshipPagination } from './public-sponsorship-pagination.js';
import { createPublicTransparencyCache } from './public-transparency-cache.js';
import { getStripePublicTransparencySummary } from './stripe-transparency.service.js';
import {
  beginSponsorshipRefundOperation,
  failSponsorshipRefundOperation,
  settleSponsorshipRefundOperation,
  SponsorshipRefundOperationError
} from './sponsorship-refund-operations.js';
import { processStripeWebhook } from './stripe-webhook.service.js';
import { normalizeContributionPublicReference } from './contribution-public-reference.js';
import { sponsorshipInvoiceConfig } from './sponsorship-invoice-config.js';
import {
  renderSponsorshipCreditNotePdf,
  renderSponsorshipInvoicePdf,
  sponsorshipCreditNotePdfFilename,
  sponsorshipInvoicePdfFilename
} from './sponsorship-document-pdf.service.js';
import {
  backfillMissingSponsorshipInvoices,
  createSponsorshipCreditNoteForRefund,
  getAdminSponsorshipInvoiceById,
  getAdminSponsorshipCreditNoteById,
  getSponsorshipCreditNoteById,
  getSponsorshipInvoiceById,
  listAdminSponsorshipInvoices
} from './sponsorship-invoices.repository.js';
import {
  createSponsorLogoStorage,
  createSponsorMediaStorage,
  type SponsorLogoStorageConfig
} from './sponsor-media-storage.js';
import { processSponsorImage } from './sponsor-image.service.js';
import {
  createSponsorMediaAsset,
  checkSponsorMediaUpload,
  deleteSponsorMediaAsset,
  getApprovedPublicSponsorMedia,
  getSponsorMediaStorageRecord,
  listSponsorMediaAssets,
  reviewSponsorMediaAsset,
  type SponsorMediaStorageRecord
} from './sponsor-media.repository.js';
import {
  getAdminWorkQueue,
  parseWorkQueueQuery
} from './admin-work-queue.service.js';
import { buildAdminAssistantSummary } from './admin-assistant/attention.service.js';
import { loadAdminAssistantConfig } from './admin-assistant/config.js';
import { runAdminAssistantQuery } from './admin-assistant/orchestrator.js';
import { prepareAdminAssistantDraft } from './admin-assistant/preparation.service.js';
import { getAdminAssistantContext } from './admin-assistant/context.service.js';
import { getSponsorshipProgress } from './sponsorship-progress.service.js';
import {
  isSponsorshipWebsiteVisibilityRequest,
  setSponsorshipWebsiteVisibility
} from './sponsorship-website.service.js';
import {
  InformationRequestError,
  requestSponsorshipInformation,
  validateInformationRequest
} from './sponsorship-information.service.js';
import {
  buildSponsorshipReviewReminderAdminUrl,
  loadAdminSponsorshipReviewReminderConfig,
  queueDueSponsorshipReviewReminder
} from './admin-reminder.service.js';
import {
  parseBooleanEnv,
  parseNonNegativeIntegerEnv,
  parsePositiveIntegerEnv
} from './environment-values.js';
import { createAdminTokenSessionService } from './admin-token-session.js';
import {
  createHttpTransport,
  readBody,
  readBodyBuffer
} from './http-transport.js';
import {
  parseMultipartBoundary,
  parseMultipartFormData,
  type MultipartPart
} from './http-multipart.js';
import { createRouteMatcher, firstHeaderValue } from './http-routing.js';
import { createRequestRateLimit } from './http-rate-limit.js';
import {
  parseSponsorLogoUpload,
  SPONSOR_LOGO_FILENAME_PATTERN,
  contentTypeForSponsorLogoFilename
} from './sponsor-logo-upload.js';

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
const { adminTokenMatches, createAdminSession, verifyAdminSession } =
  createAdminTokenSessionService({
    adminToken,
    sessionSecret: adminSessionSecret,
    sessionTtlMinutes: adminSessionTtlMinutes,
    isProduction,
    projectId
  });
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
const referenceLookupRateLimitMax = parseNonNegativeIntegerEnv(
  process.env.FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX,
  30
);
const referenceRecoveryRateLimitMax = parseNonNegativeIntegerEnv(
  process.env.FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX,
  10
);
const adminRateLimitMax = parseNonNegativeIntegerEnv(
  process.env.FUNDING_ADMIN_RATE_LIMIT_MAX,
  120
);
const emailQueueWorkerEnabled = loadEmailQueueWorkerEnabled();
const emailQueuePollIntervalMs = parsePositiveIntegerEnv(
  process.env.FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS,
  30_000
);
const emailQueueBatchSize = parsePositiveIntegerEnv(
  process.env.FUNDING_EMAIL_QUEUE_BATCH_SIZE,
  10
);
const adminSponsorshipReviewReminderConfig =
  loadAdminSponsorshipReviewReminderConfig();
// Read-only admin AI assistant configuration. Defaults to disabled; the
// deterministic summary endpoint works regardless of this configuration.
const adminAssistantConfig = loadAdminAssistantConfig();
const sponsorLogoMaxBytes = parsePositiveIntegerEnv(
  process.env.FUNDING_SPONSOR_LOGO_MAX_BYTES,
  512 * 1024
);
const sponsorLogoStorageDir = path.resolve(
  process.env.FUNDING_SPONSOR_LOGO_STORAGE_DIR ?? 'var/sponsor-logos'
);
const sponsorMediaStorageConfig: SponsorLogoStorageConfig = {
  driver: process.env.SPONSOR_MEDIA_STORAGE_DRIVER,
  localStorageDir: sponsorLogoStorageDir,
  s3: {
    region: process.env.SPONSOR_MEDIA_REGION,
    endpoint: process.env.SPONSOR_MEDIA_ENDPOINT,
    publicBucket: process.env.SPONSOR_MEDIA_PUBLIC_BUCKET,
    publicBaseUrl: process.env.SPONSOR_MEDIA_PUBLIC_BASE_URL,
    privateBucket: process.env.SPONSOR_MEDIA_PRIVATE_BUCKET,
    privateBaseUrl: process.env.SPONSOR_MEDIA_PRIVATE_BASE_URL,
    accessKeyId: process.env.OVH_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.OVH_S3_SECRET_ACCESS_KEY
  }
};
const sponsorLogoStorage = createSponsorLogoStorage(sponsorMediaStorageConfig);
const sponsorMediaStorage = createSponsorMediaStorage(
  sponsorMediaStorageConfig
);
const {
  maxUploadBytes: sponsorMediaMaxBytes,
  maxSupportingImages: sponsorMediaMaxSupportingImages
} = loadSponsorMediaLimits(process.env);
const trustedProxyHops = loadTrustedProxyHops(
  process.env.FUNDING_TRUSTED_PROXY_HOPS
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
// STRIPE_API_HOST/PORT/PROTOCOL let the Playwright Docker E2E stack point the
// SDK at a local Stripe API stub instead of api.stripe.com (see
// tests/stripe-stub/). Unset in every real environment, where the SDK falls
// back to its own default host.
const stripeApiHost = process.env.STRIPE_API_HOST;
const navigableSimulatedCheckout = simulatedCheckoutEnabled(process.env);
const stripeApiPort = process.env.STRIPE_API_PORT;
const stripeApiProtocol = process.env.STRIPE_API_PROTOCOL as
  'http' | 'https' | undefined;
const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      ...(stripeApiHost ? { host: stripeApiHost } : {}),
      ...(stripeApiPort ? { port: stripeApiPort } : {}),
      ...(stripeApiProtocol ? { protocol: stripeApiProtocol } : {})
    })
  : null;
const readStripeTransparency = stripe
  ? createPublicTransparencyCache(() =>
      getStripePublicTransparencySummary(stripe, { projectId })
    )
  : null;
const adminStripeBackfill =
  dbPool && stripeSecretKey
    ? new AdminStripeBackfillService(
        dbPool,
        new Stripe(stripeSecretKey, {
          ...(stripeApiHost ? { host: stripeApiHost } : {}),
          ...(stripeApiPort ? { port: stripeApiPort } : {}),
          ...(stripeApiProtocol ? { protocol: stripeApiProtocol } : {}),
          timeout: 10000,
          maxNetworkRetries: 0
        }),
        {
          apiKey: stripeSecretKey,
          projectId,
          environment: process.env.FUNDING_PLATFORM_ENV ?? 'development'
        }
      )
    : null;

loadTransactionalEmailConfig();
const readCockpitSystems = createCockpitSystemsReader({
  stripeApiConfigured: Boolean(stripe),
  stripeConnection: async () => {
    if (!stripe) throw new Error('Stripe API not configured');
    await readStripeConnection(stripe);
  },
  stripeConfigured: Boolean(stripe && stripeWebhookSecret),
  emailConfigured: getTransactionalEmailConfigStatus().configured,
  storageProvider: sponsorMediaStorage.driver === 'ovh-s3' ? 'OVH S3' : 'Local',
  databaseConfigured: Boolean(dbPool),
  database: async () => {
    if (!dbPool) throw new Error('Database unavailable');
    await readSnapshot(dbPool, async (client) => {
      await client.query('SELECT 1');
    });
  },
  stripe: () => readSystemObservation(dbPool, 'stripe'),
  email: () => readSystemObservation(dbPool, 'email'),
  storage: async (signal) => {
    if (!sponsorMediaStorage.checkReadAccess)
      throw new Error('Storage check unavailable');
    await sponsorMediaStorage.checkReadAccess(signal);
  }
});
const socialPublicationConfig = loadSocialPublicationConfig();
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

const { writeJson, writeText, writeCsv, writeBinary, writePdf, writeOptions } =
  createHttpTransport({ isProduction, allowedOrigins });
const { routeMatches, routeStartsWith } = createRouteMatcher(publicBaseOrigin);
const enforceRequestRateLimit = createRequestRateLimit(
  {
    publicBaseOrigin,
    trustedProxyHops,
    rateLimitWindowMs,
    publicWriteRateLimitMax,
    sponsorshipFollowupRateLimitMax,
    referenceLookupRateLimitMax,
    referenceRecoveryRateLimitMax,
    adminRateLimitMax
  },
  writeJson
);

const normalizeAmount = (amount: number): number =>
  Number(Number(amount).toFixed(2));

const amountToCents = (amount: number): number => Math.round(amount * 100);

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
const PUBLICATION_SLOT_DEFAULT_TIMEZONE = 'America/Toronto';
const PUBLICATION_SLOT_TIMEZONE_MAX_LENGTH = 64;
const FOLLOWUP_TOKEN_BYTES = 32;
const CONTRIBUTION_REFERENCE_BYTES = 6;
const CONTRIBUTION_REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SPONSOR_LOGO_PUBLIC_PATH_PREFIX = '/api/public/sponsor-logos/';
const SPONSOR_MEDIA_PUBLIC_PATH_PREFIX = '/api/public/sponsor-media/';
const SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH = 300;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const followupEditablePaymentStatuses = new Set([
  'paid',
  'refunded',
  'disputed'
]);
const allowedSponsorshipRejectionRefundHandling =
  new Set<AdminSponsorshipRejectionRefundHandling>([
    'none',
    'manual_required',
    'manual_completed'
  ]);
const allowedSponsorshipStripeRefundReasons =
  new Set<AdminSponsorshipStripeRefundReason>([
    'requested_by_customer',
    'duplicate',
    'fraudulent'
  ]);

const isNonEmptySponsorText = (
  value: unknown,
  maxLength: number
): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= maxLength;

const isValidSponsorEmail = (value: unknown): value is string =>
  isSponsorshipEmail(value, SPONSOR_TEXT_MAX_LENGTH);

const hasOnlyKeys = (value: unknown, keys: readonly string[]): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

const isValidOptionalHttpsUrl = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  if (typeof value !== 'string' || value.length > SPONSOR_URL_MAX_LENGTH) {
    return false;
  }

  try {
    return isSponsorshipHttpsUrl(value);
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

const isAllowedSponsorshipRejectionRefundHandling = (
  value: unknown
): value is AdminSponsorshipRejectionRefundHandling =>
  typeof value === 'string' &&
  allowedSponsorshipRejectionRefundHandling.has(
    value as AdminSponsorshipRejectionRefundHandling
  );

const isAllowedSponsorshipStripeRefundReason = (
  value: unknown
): value is AdminSponsorshipStripeRefundReason =>
  typeof value === 'string' &&
  allowedSponsorshipStripeRefundReasons.has(
    value as AdminSponsorshipStripeRefundReason
  );

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

const sponsorLogoPublicUrlForFilename = (filename: string): string =>
  `${SPONSOR_LOGO_PUBLIC_PATH_PREFIX}${filename}`;

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

const deleteControlledSponsorLogoFile = async (
  logoUrl: string | null
): Promise<boolean> => {
  const filename = getSponsorLogoFilenameFromUrl(logoUrl ?? undefined);
  if (!filename) {
    return false;
  }

  if (!SPONSOR_LOGO_FILENAME_PATTERN.test(filename)) {
    return false;
  }

  try {
    return await sponsorLogoStorage.deleteLogo(filename);
  } catch (error) {
    console.warn('Failed to delete controlled sponsor logo object.', error);
    return false;
  }
};

const allowedSponsorMediaKinds = new Set<SponsorMediaKind>([
  'logo',
  'supporting_image'
]);

const parseSponsorMediaKind = (value: string): SponsorMediaKind | null =>
  allowedSponsorMediaKinds.has(value as SponsorMediaKind)
    ? (value as SponsorMediaKind)
    : null;

const sponsorMediaPrivateBaseKey = (
  contributionId: string,
  assetId: string
): string => `sponsors/${contributionId}/${assetId}`;

const sponsorMediaPublicKey = (asset: SponsorMediaStorageRecord): string =>
  `public/sponsors/${asset.contributionId}/${asset.id}-${asset.checksumSha256.slice(0, 16)}.webp`;

const sponsorMediaPublicUrl = (assetId: string, publicKey: string): string =>
  sponsorMediaStorage.publicUrl(publicKey) ??
  `${SPONSOR_MEDIA_PUBLIC_PATH_PREFIX}${assetId}`;

const routeAssetId = (
  url: string | undefined,
  ...prefixes: readonly string[]
): string | null => {
  if (!url) {
    return null;
  }
  try {
    const pathname = new URL(url, publicBaseOrigin).pathname;
    const prefix = prefixes.find((candidate) => pathname.startsWith(candidate));
    if (!prefix) {
      return null;
    }
    const assetId = decodeURIComponent(pathname.slice(prefix.length));
    return isValidUuid(assetId) ? assetId : null;
  } catch {
    return null;
  }
};

const deleteSponsorMediaObjects = async (
  asset: SponsorMediaStorageRecord,
  options: { readonly includePublic: boolean }
): Promise<void> => {
  const operations = [
    sponsorMediaStorage.deletePrivateObject(asset.originalStorageKey),
    sponsorMediaStorage.deletePrivateObject(asset.processedStorageKey)
  ];
  if (options.includePublic && asset.publicStorageKey) {
    operations.push(
      sponsorMediaStorage.deletePublicObject(asset.publicStorageKey)
    );
  }
  const results = await Promise.allSettled(operations);
  if (results.some((result) => result.status === 'rejected')) {
    console.warn('One or more sponsor media objects could not be deleted.', {
      assetId: asset.id,
      storageDriver: sponsorMediaStorage.driver
    });
  }
};

const writeSponsorMediaMutationFailure = (
  request: ApiRequest,
  response: ApiResponse,
  status: 'not_found' | 'conflict' | 'approved_locked' | 'not_editable'
): void => {
  if (status === 'not_editable') {
    writeJson(request, response, 409, {
      code: 'SPONSORSHIP_NOT_EDITABLE',
      error: 'Sponsorship is not editable.'
    });
    return;
  }
  if (status === 'conflict') {
    writeJson(request, response, 409, {
      code: 'SPONSOR_MEDIA_CONCURRENT_UPDATE',
      error: 'Ce media a ete modifie. Rechargez la fiche puis reessayez.'
    });
    return;
  }
  if (status === 'approved_locked') {
    writeJson(request, response, 409, {
      code: 'SPONSOR_MEDIA_APPROVED',
      error: "Un media approuve doit etre retire par l'administrateur."
    });
    return;
  }
  writeJson(request, response, 404, { error: 'Sponsor media was not found.' });
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

const normalizeReferenceRecoveryEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const email = value.trim().toLowerCase();
  return isValidEmailAddress(email) ? email : null;
};

const createReferenceRecoveryIdempotencyKey = (email: string): string => {
  const emailHash = createHash('sha256').update(email).digest('hex');
  const hourBucket = new Date().toISOString().slice(0, 13);

  return `reference-recovery:${emailHash}:${hourBucket}`;
};

const buildContributionReceiptDescription = (publicReference: string): string =>
  `Reference OpenG7: ${publicReference}`;

const buildContributionCheckoutSuccessUrl = (
  returnUrl: string,
  publicReference: string
): string => {
  const url = new URL(returnUrl, publicBaseOrigin);
  url.searchParams.set('reference', publicReference);
  return url.toString();
};

const stripeCheckoutSessionStatus = (
  session: Stripe.Checkout.Session
): 'pending' | 'paid' | 'expired' => {
  if (session.payment_status === 'paid') {
    return 'paid';
  }

  return session.status === 'expired' ? 'expired' : 'pending';
};

const checkoutSessionPaidAtIso = (
  session: Stripe.Checkout.Session,
  status: 'pending' | 'paid' | 'expired'
): string | null =>
  status === 'paid' ? new Date(session.created * 1000).toISOString() : null;

const refreshSponsorshipFollowupPaymentStatus = async (
  followup: SponsorshipFollowupLookup,
  tokenHash: string
): Promise<SponsorshipFollowupLookup> => {
  if (
    followupEditablePaymentStatuses.has(followup.paymentStatus) ||
    !stripe ||
    !followup.stripeSessionId
  ) {
    return followup;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(
      followup.stripeSessionId,
      {
        expand: ['payment_intent']
      }
    );
    const metadata = session.metadata ?? {};
    const sessionTokenHash = metadata.sponsorshipFollowupTokenHash ?? null;

    if (
      normalizeContributionType(metadata.contributionType) !==
        'sponsorship_interest' ||
      (sessionTokenHash !== null && sessionTokenHash !== tokenHash)
    ) {
      return followup;
    }

    const status = stripeCheckoutSessionStatus(session);
    await upsertCheckoutSessionFromWebhook(dbPool, {
      notifyAdmin: true,
      stripeSessionId: session.id,
      stripePaymentIntentId: resolveStripePaymentIntentId(
        session.payment_intent
      ),
      publicReference: normalizeContributionPublicReference(
        metadata.publicReference ?? session.client_reference_id
      ),
      contributionType: 'sponsorship_interest',
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? 'cad',
      metadata,
      publicDisplayConsent: parseMetadataBoolean(metadata.publicDisplayConsent),
      publicName: metadata.publicDisplayName ?? null,
      displayAmountConsent: parseMetadataBoolean(metadata.displayAmountConsent),
      nonCharityAcknowledged: parseMetadataBoolean(
        metadata.nonCharityAcknowledged
      ),
      sponsorshipFollowupTokenHash: sessionTokenHash ?? tokenHash,
      status,
      paidAtIso: checkoutSessionPaidAtIso(session, status),
      emailPrivate: session.customer_details?.email ?? null
    });

    return (
      (await getSponsorshipFollowupByTokenHash(
        dbPool,
        tokenHash,
        getSponsorshipFollowupTokenCutoffIso()
      )) ?? followup
    );
  } catch (error) {
    console.error(
      'Failed to refresh sponsorship follow-up payment status from Stripe.',
      error
    );
    return followup;
  }
};

const getFreshSponsorshipFollowupByToken = async (
  token: string
): Promise<SponsorshipFollowupLookup | null> => {
  const tokenHash = hashSponsorshipFollowupToken(token);
  const followup = await getSponsorshipFollowupByTokenHash(
    dbPool,
    tokenHash,
    getSponsorshipFollowupTokenCutoffIso()
  );

  return followup
    ? refreshSponsorshipFollowupPaymentStatus(followup, tokenHash)
    : null;
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
  status:
    | 'updated'
    | 'not_found'
    | 'conflict'
    | 'payment_not_eligible'
    | 'media_required',
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

  if (status === 'media_required') {
    writeJson(request, response, 409, {
      code: 'SPONSORSHIP_PRESENTATION_PHOTO_REQUIRED',
      message:
        "Une photo de presentation approuvee est requise avant d'approuver cette commandite."
    });
    return;
  }

  writeJson(request, response, 404, {
    error: 'Sponsorship contribution was not found.'
  });
};

const sponsorshipRefundConfirmationText = (input: {
  readonly publicReference: string | null;
  readonly id: string;
}): string => input.publicReference ?? input.id;

const writeSponsorshipRefundIneligible = (
  request: IncomingMessage,
  response: ServerResponse,
  paymentStatus: string | null
): void => {
  writeJson(request, response, 409, {
    code: 'SPONSORSHIP_REFUND_NOT_ELIGIBLE',
    message:
      paymentStatus === 'refunded'
        ? 'Cette commandite est deja marquee comme remboursee.'
        : paymentStatus === 'disputed'
          ? 'Cette commandite est contestee; traitez le dossier dans Stripe.'
          : 'Cette commandite ne peut pas etre remboursee automatiquement.',
    paymentStatus
  });
};

const isValidPublicationBatchCapacity = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= PUBLICATION_BATCH_MIN_CAPACITY &&
  value <= PUBLICATION_BATCH_MAX_CAPACITY;

const isFutureDateString = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  Date.parse(value) > Date.now();

const isValidPublicationSlotTimezone = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > PUBLICATION_SLOT_TIMEZONE_MAX_LENGTH
  ) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('fr-CA', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
};

const normalizePublicationSlotTimezone = (value: unknown): string =>
  isValidPublicationSlotTimezone(value)
    ? value.trim()
    : PUBLICATION_SLOT_DEFAULT_TIMEZONE;

const channelLabel = (channel: SponsorFeedChannel): string =>
  channel === 'linkedin' ? 'LinkedIn' : 'Facebook';

const socialPublicationRuntime = (): {
  readonly mode: typeof socialPublicationConfig.mode;
  readonly configuredChannels: readonly SponsorFeedChannel[];
} => ({
  mode: socialPublicationConfig.mode,
  configuredChannels: configuredSocialPublicationChannels(
    socialPublicationConfig
  )
});

const isAllowedPublicationDraftStatus = (
  value: unknown
): value is NonNullable<AdminPublicationDraftUpdateRequest['status']> =>
  typeof value === 'string' &&
  allowedPublicationDraftStatuses.has(
    value as NonNullable<AdminPublicationDraftUpdateRequest['status']>
  );

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

const adminAuthMode = process.env.FUNDING_ADMIN_AUTH_MODE ?? 'token';
if (!['token', 'oidc'].includes(adminAuthMode))
  throw new Error('Invalid admin auth mode.');
if (adminAuthMode === 'oidc' && !dbPool)
  throw new Error('OIDC requires PostgreSQL.');
const adminIdentity =
  adminAuthMode === 'oidc'
    ? new AdminIdentityService(dbPool!, process.env)
    : null;

interface AdminAuthorization {
  readonly actor: string;
  readonly source: 'session' | 'static-token' | 'local-dev' | 'oidc';
}

const resolveAdminAuthorization = (
  request: ApiRequest
): AdminAuthorization | null => {
  if (adminIdentity) {
    const identity = adminIdentity.identity(request);
    return identity ? { actor: `admin:${identity.id}`, source: 'oidc' } : null;
  }
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
  if (!adminIdentity && !adminToken && isProduction) {
    writeJson(request, response, 503, {
      error: 'Admin review is not configured.'
    });
    return false;
  }

  if (
    adminIdentity &&
    adminIdentity.identity(request) &&
    !adminIdentity.permits(request)
  ) {
    writeJson(request, response, 403, {
      error: 'This action is not permitted for this account or origin.'
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

// Best-effort audit for admin assistant usage. Never stores the free-text
// question (it may contain private data) — only which tool/data was consulted,
// the actor, the outcome and timing. A failed audit never breaks the response.
const recordAdminAssistantAudit = async (
  request: ApiRequest,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> => {
  if (!dbPool) {
    return;
  }
  try {
    await insertAdminAuditLog(dbPool, {
      actor: getAdminAuditActor(request),
      action,
      entityType: 'admin_assistant',
      entityId: null,
      summary: null,
      metadata
    });
  } catch (error) {
    console.error('Failed to record admin assistant audit.', error);
  }
};

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
  const emailStatus = getTransactionalEmailConfigStatus();

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
      smtp_enabled: emailStatus.enabled,
      smtp_configured: emailStatus.configured,
      smtp_host: emailStatus.host,
      smtp_port: emailStatus.port,
      smtp_secure: emailStatus.secure,
      smtp_user_configured: emailStatus.userConfigured,
      smtp_password_configured: emailStatus.passwordConfigured,
      from: emailStatus.from,
      reply_to: emailStatus.replyTo,
      admin_notification_email:
        process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() || null,
      admin_review_reminder_enabled:
        adminSponsorshipReviewReminderConfig.enabled,
      admin_review_reminder_min_age_days:
        adminSponsorshipReviewReminderConfig.minAgeDays,
      admin_review_reminder_poll_interval_ms:
        adminSponsorshipReviewReminderConfig.pollIntervalMs,
      admin_review_reminder_max_items:
        adminSponsorshipReviewReminderConfig.maxItems,
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
      prefix: sponsorshipInvoiceConfig.invoicePrefix,
      issuer_name: sponsorshipInvoiceConfig.issuerName || null,
      issuer_email: sponsorshipInvoiceConfig.issuerEmail || null,
      issuer_address_configured: Boolean(
        sponsorshipInvoiceConfig.issuerAddress
      ),
      issuer_tax_id_configured: Boolean(sponsorshipInvoiceConfig.issuerTaxId),
      tax_label: sponsorshipInvoiceConfig.taxLabel,
      ready: Boolean(
        sponsorshipInvoiceConfig.issuerName &&
        sponsorshipInvoiceConfig.issuerEmail
      )
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

// Mirrors createDevelopmentCheckoutResult: lets the admin refund workflow
// (credit note, refund email, audit log) run end-to-end in local/E2E
// environments where STRIPE_SECRET_KEY is empty, without calling Stripe.
// Only the fields the refund handler actually reads (id/amount/currency/
// status) are populated; production always goes through the real SDK call.
const createDevelopmentRefundResult = (params: {
  readonly amountCents: number;
  readonly currency: string;
  readonly paymentIntentId: string;
}): Stripe.Refund =>
  ({
    id: `re_dev_${randomBytes(12).toString('hex')}`,
    amount: params.amountCents,
    currency: params.currency,
    status: 'succeeded',
    payment_intent: params.paymentIntentId
  }) as Stripe.Refund;

const resolveStripePaymentIntentId = (
  paymentIntent: string | Stripe.PaymentIntent | null
): string | null => {
  if (!paymentIntent) {
    return null;
  }

  return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id;
};

let emailQueueProcessing = false;
let adminSponsorshipReviewReminderProcessing = false;

const runEmailQueueWorker = async (): Promise<void> => {
  if (!dbPool || !emailQueueWorkerEnabled || emailQueueProcessing) {
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

const runAdminSponsorshipReviewReminderWorker = async (): Promise<void> => {
  if (!dbPool || adminSponsorshipReviewReminderProcessing) {
    return;
  }

  adminSponsorshipReviewReminderProcessing = true;
  try {
    const result = await queueDueSponsorshipReviewReminder(dbPool, {
      config: adminSponsorshipReviewReminderConfig,
      adminUrl: buildSponsorshipReviewReminderAdminUrl(publicBaseUrl)
    });

    if (result.checked && !result.duplicate && (result.queued || result.sent)) {
      console.info(
        `Admin sponsorship review reminder queued for ${result.dueCount} pending sponsorship(s).`
      );
    }

    if (result.checked && !result.duplicate && result.error) {
      console.warn(
        'Admin sponsorship review reminder could not be delivered.',
        result.error
      );
    }
  } catch (error) {
    console.error('Failed to queue admin sponsorship review reminder.', error);
  } finally {
    adminSponsorshipReviewReminderProcessing = false;
  }
};

const publicationAutomation = dbPool
  ? new PublicationAutomationService(dbPool, sponsorMediaStorage)
  : null;
const contributionNotifications = contributionNotificationConfig(process.env);
const contributionActivity = dbPool
  ? new ContributionActivityService(dbPool, contributionNotifications)
  : null;
const runContributionActivity = async (): Promise<void> => {
  try {
    await contributionActivity?.tick();
  } catch {
    console.error(
      'Contribution activity worker interrupted; verify migration 027 and database availability.'
    );
  }
};
const adminPilotage =
  dbPool && publicationAutomation
    ? new AdminPilotageService(dbPool, publicationAutomation)
    : null;
const runPublicationWorker = async (): Promise<void> => {
  try {
    await publicationAutomation?.tick();
  } catch {
    console.error(
      'Publication worker interrupted; inspect publication exceptions and database availability.'
    );
  }
};

const handleAdminContributionsRequest = createAdminContributionsHttpHandler({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  writeCsv,
  listAdminContributions: (contributionId) =>
    listAdminContributions(dbPool, contributionId),
  exportAdminContributions: (input, actor) =>
    exportAdminContributions(dbPool!, input, actor),
  ContributionExportError,
  reportFailure: (message, error) => {
    if (error === undefined) console.error(message);
    else console.error(message, error);
  }
});

const handleAdminDocumentsRequest = createAdminDocumentsHttpHandler({
  publicBaseOrigin,
  databaseAvailable: () => Boolean(dbPool),
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  writePdf,
  getTransactionalEmailConfigStatus,
  isValidUuid,
  isValidSponsorEmail,
  listAdminSponsorshipInvoices: (contributionId) =>
    listAdminSponsorshipInvoices(dbPool, contributionId),
  backfillMissingSponsorshipInvoices: (input) =>
    backfillMissingSponsorshipInvoices(dbPool!, input),
  insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input),
  getSponsorshipInvoiceById: (invoiceId) =>
    getSponsorshipInvoiceById(dbPool!, invoiceId),
  getAdminSponsorshipInvoiceById: (invoiceId) =>
    getAdminSponsorshipInvoiceById(dbPool, invoiceId),
  getSponsorshipCreditNoteById: (creditNoteId) =>
    getSponsorshipCreditNoteById(dbPool!, creditNoteId),
  getAdminSponsorshipCreditNoteById: (creditNoteId) =>
    getAdminSponsorshipCreditNoteById(dbPool, creditNoteId),
  renderSponsorshipInvoicePdf,
  renderSponsorshipCreditNotePdf,
  sponsorshipInvoicePdfFilename,
  sponsorshipCreditNotePdfFilename,
  queueAdminDocumentResend: (input, actor) =>
    queueAdminDocumentResend(dbPool!, input, actor),
  DocumentResendConflict,
  reportFailure: (message, error) => {
    if (error === undefined) console.error(message);
    else console.error(message, error);
  }
});

const handleAdminAccountingRequest = createAdminAccountingHttpHandler({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  allowedAdminExpenseStatuses,
  isNonEmptySponsorText,
  isValidOptionalBoundedText,
  isValidOptionalNonEmptyBoundedText,
  isValidOptionalIsoDate,
  isValidAdminExpectedVersion,
  listAdminExpenses: (expenseId) => listAdminExpenses(dbPool, expenseId),
  createAdminExpense: (input, audit) =>
    createAdminExpense(dbPool, input, audit),
  updateAdminExpense: (input, audit) =>
    updateAdminExpense(dbPool, input, audit),
  getPublicTransparencySummary: () => getPublicTransparencySummary(dbPool),
  AdminExpenseValidationError,
  reportFailure: (message, error) => console.error(message, error)
});

const handleAdminEmailRequest = createAdminEmailHttpHandler({
  publicBaseOrigin,
  databaseAvailable: () => Boolean(dbPool),
  ensureAdminAuthorization,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  getTransactionalEmailConfigStatus,
  adminNotificationRecipient: () =>
    process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() ?? '',
  isValidSponsorEmail,
  isEmailTestRequestId,
  isValidUuid,
  EmailConfigurationTestError,
  getEmailConfigurationTest: (requestId, actor) =>
    getEmailConfigurationTest(dbPool!, requestId, actor),
  queueEmailConfigurationTest: (input) =>
    queueEmailConfigurationTest(dbPool!, input),
  listAdminEmailQueue: (scope) => listAdminEmailQueue(dbPool, scope),
  getAdminEmailQueueMessageById: (messageId) =>
    getAdminEmailQueueMessageById(dbPool, messageId),
  retryAdminEmailQueueMessage: (messageId) =>
    retryAdminEmailQueueMessage(dbPool, messageId),
  insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input),
  reportFailure: (message, error) => console.error(message, error)
});

const handleAdminInsightsRequest = createAdminInsightsHttpHandler({
  publicBaseOrigin,
  ensureAdminAuthorization,
  ensureAdminAccess,
  readBody,
  writeJson,
  validStripeEventId,
  getAdminStripeEvent: (id) => getAdminStripeEvent(dbPool, id),
  parseAdminSearch,
  searchAdmin: (query) => searchAdmin(dbPool, query),
  parseWorkQueueQuery,
  getAdminWorkQueue: (query) => getAdminWorkQueue(dbPool, query),
  getCockpitMetrics: () => getCockpitMetrics(dbPool),
  getCockpitActivity: () => getCockpitActivity(dbPool),
  readCockpitSystems,
  getAdminDashboard: () => getAdminDashboard(dbPool),
  reportFailure: (message, error) => console.error(message, error)
});

const handleRequest = async (
  request: ApiRequest,
  response: ApiResponse
): Promise<void> => {
  if (request.method === 'OPTIONS') {
    writeOptions(request, response);
    return;
  }

  if (!enforceRequestRateLimit(request, response)) {
    return;
  }
  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/sponsorship-followup/details',
      '/api/sponsorship-followup/details',
      '/sponsorship-followup/draft',
      '/api/sponsorship-followup/draft',
      '/sponsorship-followup/recover',
      '/api/sponsorship-followup/recover',
      '/sponsorship-followup/media/delete',
      '/api/sponsorship-followup/media/delete'
    ) &&
    request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
      'application/json'
  ) {
    writeJson(request, response, 415, {
      code: 'JSON_REQUIRED',
      error: 'Content-Type must be application/json.'
    });
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(request.url, '/admin/auth/config', '/api/admin/auth/config')
  ) {
    writeJson(request, response, 200, { mode: adminAuthMode });
    return;
  }
  if (adminIdentity && routeStartsWith(request.url, '/admin/', '/api/admin/')) {
    try {
      await adminIdentity.resolve(request);
      if (await adminIdentity.handle(request, response)) return;
    } catch {
      writeJson(request, response, 503, {
        error: 'Identity service unavailable.'
      });
      return;
    }
  }

  if (
    routeMatches(
      request.url,
      '/admin/stripe-backfill',
      '/api/admin/stripe-backfill'
    )
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    if (!ensureAdminAccess(request, response)) return;
    if (resolveAdminAuthorization(request)?.source === 'local-dev') {
      writeJson(request, response, 401, { code: 'ADMIN_SESSION_REQUIRED' });
      return;
    }
    if (!adminStripeBackfill) {
      writeJson(request, response, 503, { code: 'BACKFILL_UNAVAILABLE' });
      return;
    }
    const actor = getAdminAuditActor(request);
    try {
      if (request.method === 'GET') {
        const id = new URL(
          request.url ?? '/',
          publicBaseOrigin
        ).searchParams.get('id');
        writeJson(request, response, 200, {
          run: await adminStripeBackfill.read(id, actor)
        });
      } else if (request.method === 'POST') {
        if (
          request.headers.origin &&
          ![publicBaseOrigin, ...allowedOrigins].includes(
            request.headers.origin
          )
        ) {
          writeJson(request, response, 403, { code: 'ORIGIN_FORBIDDEN' });
          return;
        }
        if (
          request.headers['content-type']?.split(';')[0].trim() !==
          'application/json'
        ) {
          writeJson(request, response, 415, { code: 'JSON_REQUIRED' });
          return;
        }
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(await readBody(request, 4096));
          if (!input || typeof input !== 'object' || Array.isArray(input))
            throw new Error();
          const fields =
            input.action === 'preview'
              ? ['action', 'scope']
              : ['action', 'id', 'confirmation'];
          if (
            Object.keys(input).some((key) => !fields.includes(key)) ||
            !['preview', 'execute'].includes(String(input.action))
          )
            throw new Error();
        } catch {
          writeJson(request, response, 400, { code: 'INVALID_REQUEST' });
          return;
        }
        const run =
          input.action === 'preview'
            ? await adminStripeBackfill.preview(input.scope, actor)
            : await adminStripeBackfill.execute(
                input.id,
                input.confirmation,
                actor
              );
        writeJson(request, response, 200, { run });
      } else writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      const known = error instanceof AdminStripeBackfillError;
      writeJson(request, response, known ? error.status : 503, {
        code: known ? error.code : 'BACKFILL_UNAVAILABLE'
      });
    }
    return;
  }

  if (
    routeMatches(
      request.url,
      '/admin/pilotage',
      '/api/admin/pilotage',
      '/admin/pilotage/command',
      '/api/admin/pilotage/command',
      '/admin/pilotage/receipt',
      '/api/admin/pilotage/receipt',
      '/admin/pilotage/programme',
      '/api/admin/pilotage/programme',
      '/admin/pilotage/variant',
      '/api/admin/pilotage/variant'
    )
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    if (!ensureAdminAccess(request, response)) return;
    if (!adminPilotage) {
      writeJson(request, response, 503, { code: 'PILOTAGE_UNAVAILABLE' });
      return;
    }
    try {
      const url = new URL(request.url ?? '/', publicBaseOrigin);
      const writable = adminIdentity?.identity(request)?.role !== 'reader';
      const owner =
        !adminIdentity || adminIdentity.identity(request)?.role === 'owner';
      const actor = getAdminAuditActor(request);
      if (
        url.pathname.endsWith('/programme') ||
        url.pathname.endsWith('/variant')
      ) {
        if (request.method === 'GET' && url.pathname.endsWith('/programme')) {
          writeJson(
            request,
            response,
            200,
            await adminPilotage.editorial.state(writable)
          );
        } else if (request.method === 'POST') {
          if (!writable) throw new PilotError('READ_ONLY', 403);
          if (
            !request.headers['content-type']
              ?.toLowerCase()
              .startsWith('application/json')
          )
            throw new PilotError('INVALID_COMMAND', 415);
          const input = JSON.parse(await readBody(request, 4096));
          const result = url.pathname.endsWith('/variant')
            ? await adminPilotage.editorial.variant(input)
            : await adminPilotage.editorial.propose(input);
          writeJson(request, response, 200, result);
        } else
          writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
      } else if (
        request.method === 'POST' &&
        url.pathname.endsWith('/command')
      ) {
        if (
          !request.headers['content-type']
            ?.toLowerCase()
            .startsWith('application/json')
        )
          throw new PilotError('INVALID_COMMAND', 415);
        writeJson(
          request,
          response,
          200,
          await adminPilotage.command(
            JSON.parse(await readBody(request, 16 * 1024)),
            actor,
            writable,
            owner
          )
        );
      } else if (
        request.method === 'POST' &&
        url.pathname.endsWith('/receipt')
      ) {
        if (!writable) throw new PilotError('READ_ONLY', 403);
        if (
          !request.headers['content-type']
            ?.toLowerCase()
            .startsWith('application/json')
        )
          throw new PilotError('INVALID_COMMAND', 415);
        writeJson(
          request,
          response,
          200,
          await adminPilotage.acknowledgeReceipt(
            JSON.parse(await readBody(request, 4096)),
            actor
          )
        );
      } else if (
        request.method === 'GET' &&
        url.pathname.endsWith('/receipt')
      ) {
        const result = await adminPilotage.readReceipt(
          url.searchParams.get('id') ?? '',
          actor
        );
        writeJson(
          request,
          response,
          result ? 200 : 404,
          result ?? { code: 'RECEIPT_NOT_FOUND' }
        );
      } else if (
        request.method === 'GET' &&
        url.pathname.endsWith('/pilotage')
      ) {
        const page = Number(url.searchParams.get('page') ?? 1);
        if (!Number.isSafeInteger(page) || page < 1)
          throw new PilotError('INVALID_QUERY', 400);
        writeJson(
          request,
          response,
          200,
          await adminPilotage.state(
            {
              page,
              domain: url.searchParams.get('domain') ?? undefined,
              id: url.searchParams.get('id') ?? undefined
            },
            writable,
            owner
          )
        );
      } else writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      writeJson(
        request,
        response,
        error instanceof PilotError ||
          error instanceof PublicationAutomationError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 503,
        {
          code:
            error instanceof PilotError ||
            error instanceof PublicationAutomationError
              ? error.code
              : 'PILOTAGE_UNAVAILABLE'
        }
      );
    }
    return;
  }

  if (
    routeMatches(
      request.url,
      '/admin/contribution-activity/present',
      '/api/admin/contribution-activity/present'
    )
  ) {
    if (!ensureAdminAccess(request, response)) return;
    if (request.method !== 'POST') {
      writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      const input = JSON.parse(await readBody(request)) as { ids?: unknown };
      const result = await contributionActivity!.claimPresentation(
        input?.ids,
        getAdminAuditActor(request)
      );
      writeJson(request, response, 200, result);
    } catch (error) {
      writeJson(
        request,
        response,
        error instanceof RangeError || error instanceof SyntaxError ? 400 : 503,
        { code: 'ACTIVITY_PRESENTATION_FAILED' }
      );
    }
    return;
  }
  if (
    routeMatches(
      request.url,
      '/admin/contribution-activity',
      '/api/admin/contribution-activity'
    )
  ) {
    if (!ensureAdminAccess(request, response)) return;
    if (request.method !== 'GET') {
      writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      const params = new URL(request.url ?? '/', publicBaseOrigin).searchParams;
      const result = await contributionActivity!.list({
        ...(params.has('before') ? { before: params.get('before')! } : {}),
        ...(params.has('after') ? { after: params.get('after')! } : {}),
        ...(params.has('id') ? { id: params.get('id')! } : {})
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      writeJson(request, response, error instanceof RangeError ? 400 : 503, {
        code:
          error instanceof RangeError
            ? 'INVALID_ACTIVITY_CURSOR'
            : 'ACTIVITY_UNAVAILABLE'
      });
    }
    return;
  }

  if (
    routeMatches(
      request.url,
      '/admin/publication-automation',
      '/api/admin/publication-automation',
      '/admin/publication-automation/media',
      '/api/admin/publication-automation/media'
    )
  ) {
    if (!ensureAdminAccess(request, response) || !publicationAutomation) return;
    try {
      if (request.method === 'GET') {
        const automationUrl = new URL(request.url ?? '/', publicBaseOrigin);
        const isMedia = automationUrl.pathname.endsWith('/media');
        writeJson(
          request,
          response,
          200,
          isMedia
            ? await publicationAutomation.mediaOptions()
            : await publicationAutomation.state(undefined, {
                sponsorshipId:
                  automationUrl.searchParams.get('sponsorshipId') ?? undefined,
                deliveryId:
                  automationUrl.searchParams.get('deliveryId') ?? undefined
              })
        );
      } else if (
        request.method === 'POST' &&
        !new URL(request.url ?? '/', publicBaseOrigin).pathname.endsWith(
          '/media'
        )
      ) {
        const input = JSON.parse(
          await readBody(request)
        ) as PublicationAutomationCommand;
        writeJson(
          request,
          response,
          200,
          await publicationAutomation.command(
            input,
            getAdminAuditActor(request)
          )
        );
      } else writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      const status =
        error instanceof PublicationAutomationError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 503;
      writeJson(request, response, status, {
        code:
          error instanceof PublicationAutomationError
            ? error.code
            : 'AUTOMATION_UNAVAILABLE'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/media',
      '/api/admin/sponsorships/media'
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
      const result: SponsorshipMediaResponse = {
        assets: await listSponsorMediaAssets(dbPool, contributionId),
        limits: {
          maxUploadBytes: sponsorMediaMaxBytes,
          maxSupportingImages: sponsorMediaMaxSupportingImages,
          acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
        }
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to list sponsor media for admin.', error);
      writeJson(request, response, 502, {
        error: 'Sponsor media could not be loaded. Apply migration 017.'
      });
    }
    return;
  }

  const adminMediaContentId =
    request.method === 'GET'
      ? routeAssetId(
          request.url,
          '/admin/sponsorships/media/content/',
          '/api/admin/sponsorships/media/content/'
        )
      : null;
  if (adminMediaContentId) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }
    try {
      const asset = await getSponsorMediaStorageRecord(
        dbPool,
        adminMediaContentId
      );
      const image = asset
        ? await sponsorMediaStorage.readPrivateObject(asset.processedStorageKey)
        : null;
      if (!asset || !image) {
        writeJson(request, response, 404, {
          error: 'Sponsor media was not found.'
        });
        return;
      }
      writeBinary(request, response, 200, image, 'image/webp', {
        'Cache-Control': 'private, no-store'
      });
    } catch (error) {
      console.error('Failed to load admin sponsor media preview.', error);
      writeJson(request, response, 404, {
        error: 'Sponsor media was not found.'
      });
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/sponsorship-followup/media',
      '/api/sponsorship-followup/media'
    )
  ) {
    if (!hasDatabase) {
      writeJson(request, response, 503, {
        error: 'Sponsorship media requires DATABASE_URL.'
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
      const followup = await getFreshSponsorshipFollowupByToken(token);
      if (!followup) {
        writeJson(request, response, 404, {
          error: 'Sponsorship follow-up was not found.'
        });
        return;
      }
      const result: SponsorshipMediaResponse = {
        assets: await listSponsorMediaAssets(dbPool, followup.contributionId),
        limits: {
          maxUploadBytes: sponsorMediaMaxBytes,
          maxSupportingImages: sponsorMediaMaxSupportingImages,
          acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
        }
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load sponsorship media.', error);
      writeJson(request, response, 502, {
        error: 'Sponsorship media could not be loaded. Apply migration 017.'
      });
    }
    return;
  }

  const sponsorMediaContentId =
    request.method === 'GET'
      ? routeAssetId(
          request.url,
          '/sponsorship-followup/media/content/',
          '/api/sponsorship-followup/media/content/'
        )
      : null;
  if (sponsorMediaContentId) {
    const token = firstHeaderValue(
      request.headers['x-sponsorship-followup-token']
    );
    if (!isValidFollowupToken(token)) {
      writeJson(request, response, 401, {
        error: 'Sponsorship follow-up token is required.'
      });
      return;
    }
    try {
      const [followup, asset] = await Promise.all([
        getFreshSponsorshipFollowupByToken(token),
        getSponsorMediaStorageRecord(dbPool, sponsorMediaContentId)
      ]);
      if (
        !followup ||
        !asset ||
        asset.contributionId !== followup.contributionId
      ) {
        writeJson(request, response, 404, {
          error: 'Sponsor media was not found.'
        });
        return;
      }
      const image = await sponsorMediaStorage.readPrivateObject(
        asset.processedStorageKey
      );
      if (!image) {
        writeJson(request, response, 404, {
          error: 'Sponsor media was not found.'
        });
        return;
      }
      writeBinary(request, response, 200, image, 'image/webp', {
        'Cache-Control': 'private, no-store'
      });
    } catch (error) {
      console.error('Failed to load sponsorship media preview.', error);
      writeJson(request, response, 404, {
        error: 'Sponsor media was not found.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/sponsorship-followup/media',
      '/api/sponsorship-followup/media'
    )
  ) {
    if (!hasDatabase) {
      writeJson(request, response, 503, {
        error: 'Sponsorship media requires DATABASE_URL.'
      });
      return;
    }
    const boundary = parseMultipartBoundary(request.headers['content-type']);
    if (!boundary) {
      writeJson(request, response, 400, {
        error: 'Sponsor media upload must use multipart/form-data.'
      });
      return;
    }
    let parts: readonly MultipartPart[];
    try {
      parts = parseMultipartFormData(
        await readBodyBuffer(
          request,
          sponsorMediaMaxBytes + SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES
        ),
        boundary
      );
    } catch {
      writeJson(request, response, 413, {
        code: 'SPONSOR_MEDIA_TOO_LARGE',
        error: 'Sponsor media upload is too large.'
      });
      return;
    }
    const textPart = (name: string): string =>
      parts
        .find((part) => part.name === name)
        ?.data.toString('utf8')
        .trim() ?? '';
    const token = textPart('token');
    const kind = parseSponsorMediaKind(textPart('kind'));
    const altText = textPart('altText') || null;
    const file = parts.find((part) => part.name === 'media');
    if (file && file.data.byteLength > sponsorMediaMaxBytes) {
      writeJson(request, response, 413, {
        code: 'SPONSOR_MEDIA_TOO_LARGE',
        error: 'Sponsor media upload is too large.'
      });
      return;
    }
    if (
      parts.some(
        (part) => !['token', 'kind', 'altText', 'media'].includes(part.name)
      ) ||
      new Set(parts.map((part) => part.name)).size !== parts.length ||
      !isValidFollowupToken(token) ||
      !kind ||
      !file?.filename ||
      file.data.byteLength === 0 ||
      (altText !== null && !isSafeSponsorshipText(altText)) ||
      (altText?.length ?? 0) > SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH
    ) {
      writeJson(request, response, 400, {
        error: 'A valid token, media kind, and image file are required.'
      });
      return;
    }

    let originalStorageKey: string | null = null;
    let processedStorageKey: string | null = null;
    try {
      const followup = await getFreshSponsorshipFollowupByToken(token);
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

      const eligibility = await checkSponsorMediaUpload(
        dbPool,
        followup.contributionId,
        kind,
        sponsorMediaMaxSupportingImages
      );
      if (eligibility !== 'allowed') {
        const error =
          eligibility === 'supporting_image_limit_reached'
            ? 'The supporting image limit has been reached.'
            : eligibility === 'logo_locked'
              ? 'The approved logo must be replaced by an administrator.'
              : eligibility === 'not_editable'
                ? 'Sponsorship is not editable.'
                : 'Sponsorship follow-up was not found.';
        writeJson(
          request,
          response,
          eligibility === 'contribution_not_found' ? 404 : 409,
          { code: eligibility, error }
        );
        return;
      }

      const image = await processSponsorImage({
        data: file.data,
        kind,
        originalFilename: file.filename
      });
      if (file.contentType && file.contentType !== image.originalMimeType) {
        writeJson(request, response, 400, {
          error: 'The declared image type does not match its contents.'
        });
        return;
      }
      const assetId = randomUUID();
      const baseKey = sponsorMediaPrivateBaseKey(
        followup.contributionId,
        assetId
      );
      originalStorageKey = `${baseKey}/original.${image.originalExtension}`;
      processedStorageKey = `${baseKey}/processed.webp`;
      await sponsorMediaStorage.writePrivateObject({
        key: originalStorageKey,
        data: image.originalData,
        contentType: image.originalMimeType
      });
      await sponsorMediaStorage.writePrivateObject({
        key: processedStorageKey,
        data: image.processedData,
        contentType: image.processedMimeType
      });

      const created = await createSponsorMediaAsset(dbPool, {
        id: assetId,
        contributionId: followup.contributionId,
        kind,
        uploadedBy: 'sponsor',
        originalFilename: image.originalFilename,
        originalMimeType: image.originalMimeType,
        originalSizeBytes: image.originalSizeBytes,
        originalStorageKey,
        processedSizeBytes: image.processedSizeBytes,
        processedStorageKey,
        checksumSha256: image.checksumSha256,
        width: image.width,
        height: image.height,
        altText,
        maxSupportingImages: sponsorMediaMaxSupportingImages
      });
      if (created.status !== 'created') {
        await Promise.allSettled([
          sponsorMediaStorage.deletePrivateObject(originalStorageKey),
          sponsorMediaStorage.deletePrivateObject(processedStorageKey)
        ]);
        const statusCode =
          created.status === 'contribution_not_found' ? 404 : 409;
        const error =
          created.status === 'logo_locked'
            ? 'The approved logo must be replaced by an administrator.'
            : created.status === 'supporting_image_limit_reached'
              ? 'The supporting image limit has been reached.'
              : created.status === 'not_editable'
                ? 'Sponsorship is not editable.'
                : 'Sponsorship follow-up was not found.';
        writeJson(request, response, statusCode, {
          code: created.status,
          error
        });
        return;
      }
      if (created.replaced) {
        await deleteSponsorMediaObjects(created.replaced, {
          includePublic: false
        });
      }
      await insertAdminAuditLog(dbPool, {
        actor: 'sponsor-followup',
        action: 'sponsorship.media.upload',
        entityType: 'sponsor_media_asset',
        entityId: created.asset.id,
        summary: 'Sponsor media uploaded through the private follow-up flow.',
        metadata: {
          contributionId: created.asset.contributionId,
          kind: created.asset.kind,
          mimeType: created.asset.originalMimeType,
          sizeBytes: created.asset.originalSizeBytes,
          storageDriver: sponsorMediaStorage.driver
        }
      });
      const result: SponsorMediaUploadResult = {
        uploaded: true,
        asset: created.asset
      };
      writeJson(request, response, 201, result);
    } catch (error) {
      if (originalStorageKey) {
        await sponsorMediaStorage
          .deletePrivateObject(originalStorageKey)
          .catch(() => undefined);
      }
      if (processedStorageKey) {
        await sponsorMediaStorage
          .deletePrivateObject(processedStorageKey)
          .catch(() => undefined);
      }
      console.error('Failed to upload sponsorship media.', error);
      writeJson(request, response, 400, {
        error: 'Sponsor media must be a valid JPEG, PNG, or WebP image.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/sponsorship-followup/media/delete',
      '/api/sponsorship-followup/media/delete'
    )
  ) {
    let parsed: SponsorMediaDeleteRequest;
    try {
      parsed = JSON.parse(
        await readBody(request, 16 * 1024)
      ) as SponsorMediaDeleteRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsor media delete request.'
      });
      return;
    }
    if (
      !hasOnlyKeys(parsed, [
        'token',
        'assetId',
        'expectedVersion',
        'confirmed'
      ]) ||
      parsed.confirmed !== true ||
      !isValidFollowupToken(parsed.token) ||
      !isValidUuid(parsed.assetId) ||
      !isValidAdminExpectedVersion(parsed.expectedVersion)
    ) {
      writeJson(request, response, 400, {
        error: 'A valid token, media id, and version are required.'
      });
      return;
    }
    try {
      const followup = await getFreshSponsorshipFollowupByToken(parsed.token);
      if (!followup) {
        writeJson(request, response, 404, {
          error: 'Sponsorship follow-up was not found.'
        });
        return;
      }
      const deleted = await deleteSponsorMediaAsset(dbPool, {
        assetId: parsed.assetId,
        contributionId: followup.contributionId,
        expectedVersion: parsed.expectedVersion,
        allowApproved: false
      });
      if (deleted.status !== 'updated' || !deleted.asset) {
        writeSponsorMediaMutationFailure(
          request,
          response,
          deleted.status === 'conflict'
            ? 'conflict'
            : deleted.status === 'not_editable'
              ? 'not_editable'
              : deleted.status === 'approved_locked'
                ? 'approved_locked'
                : 'not_found'
        );
        return;
      }
      await deleteSponsorMediaObjects(deleted.asset, { includePublic: false });
      await insertAdminAuditLog(dbPool, {
        actor: 'sponsor-followup',
        action: 'sponsorship.media.delete',
        entityType: 'sponsor_media_asset',
        entityId: deleted.asset.id,
        summary: 'Pending sponsor media deleted through the follow-up flow.',
        metadata: {
          contributionId: deleted.asset.contributionId,
          kind: deleted.asset.kind
        }
      });
      const result: SponsorMediaDeleteResult = {
        deleted: true,
        assetId: deleted.asset.id
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to delete sponsorship media.', error);
      writeJson(request, response, 502, {
        error: 'Sponsor media could not be deleted.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/media/review',
      '/api/admin/sponsorships/media/review'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }
    let parsed: AdminSponsorMediaReviewRequest;
    try {
      parsed = JSON.parse(
        await readBody(request, 32 * 1024)
      ) as AdminSponsorMediaReviewRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsor media review request.'
      });
      return;
    }
    const altText = parsed.altText?.trim() || null;
    const reviewStatus =
      parsed.reviewStatus === 'approved' || parsed.reviewStatus === 'rejected'
        ? parsed.reviewStatus
        : null;
    if (
      !isValidUuid(parsed.assetId) ||
      !isValidAdminExpectedVersion(parsed.expectedVersion) ||
      !reviewStatus ||
      (altText?.length ?? 0) > SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH
    ) {
      writeJson(request, response, 400, {
        error: 'Asset id, version, and review decision are required.'
      });
      return;
    }

    try {
      const current = await getSponsorMediaStorageRecord(
        dbPool,
        parsed.assetId
      );
      if (!current) {
        writeJson(request, response, 404, {
          error: 'Sponsor media was not found.'
        });
        return;
      }

      let publishedKey: string | null = null;
      let publicUrl: string | null = null;
      let removedPublicObject = false;
      if (reviewStatus === 'approved') {
        publishedKey =
          current.publicStorageKey ?? sponsorMediaPublicKey(current);
        publicUrl =
          current.publicUrl ?? sponsorMediaPublicUrl(current.id, publishedKey);
        if (!current.publicStorageKey) {
          await sponsorMediaStorage.publishObject({
            privateKey: current.processedStorageKey,
            publicKey: publishedKey,
            contentType: 'image/webp'
          });
        }
      } else if (current.publicStorageKey) {
        removedPublicObject = await sponsorMediaStorage.deletePublicObject(
          current.publicStorageKey
        );
      }

      const reviewed = await reviewSponsorMediaAsset(dbPool, {
        assetId: current.id,
        expectedVersion: parsed.expectedVersion,
        reviewStatus,
        altText,
        publicStorageKey: publishedKey,
        publicUrl,
        reviewedBy: getAdminAuditActor(request)
      });

      if (reviewed.status !== 'updated' || !reviewed.asset) {
        if (publishedKey && !current.publicStorageKey) {
          await sponsorMediaStorage
            .deletePublicObject(publishedKey)
            .catch(() => undefined);
        } else if (removedPublicObject && current.publicStorageKey) {
          await sponsorMediaStorage
            .publishObject({
              privateKey: current.processedStorageKey,
              publicKey: current.publicStorageKey,
              contentType: 'image/webp'
            })
            .catch(() => undefined);
        }
        writeSponsorMediaMutationFailure(
          request,
          response,
          reviewed.status === 'conflict'
            ? 'conflict'
            : reviewed.status === 'approved_locked'
              ? 'approved_locked'
              : 'not_found'
        );
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: `sponsorship.media.${reviewStatus}`,
        entityType: 'sponsor_media_asset',
        entityId: reviewed.asset.id,
        summary: `Sponsor media marked ${reviewStatus}.`,
        metadata: {
          contributionId: reviewed.asset.contributionId,
          kind: reviewed.asset.kind,
          storageDriver: sponsorMediaStorage.driver
        }
      });
      const result: AdminSponsorMediaReviewResult = {
        updated: true,
        asset: reviewed.asset
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to review sponsor media.', error);
      writeJson(request, response, 502, {
        error: 'Sponsor media review could not be completed.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/media/delete',
      '/api/admin/sponsorships/media/delete'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }
    let parsed: AdminSponsorMediaDeleteRequest;
    try {
      parsed = JSON.parse(
        await readBody(request, 16 * 1024)
      ) as AdminSponsorMediaDeleteRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsor media delete request.'
      });
      return;
    }
    if (parsed.confirmation !== parsed.assetId) {
      writeJson(request, response, 400, {
        code: 'CONFIRMATION_REQUIRED',
        error: 'Confirm the selected media before deleting it.'
      });
      return;
    }
    if (
      !isValidUuid(parsed.assetId) ||
      !isValidAdminExpectedVersion(parsed.expectedVersion)
    ) {
      writeJson(request, response, 400, {
        error: 'Sponsor media id and version are required.'
      });
      return;
    }
    try {
      const current = await getSponsorMediaStorageRecord(
        dbPool,
        parsed.assetId
      );
      if (!current) {
        writeJson(request, response, 404, {
          error: 'Sponsor media was not found.'
        });
        return;
      }
      let removedPublicObject = false;
      if (current.publicStorageKey) {
        removedPublicObject = await sponsorMediaStorage.deletePublicObject(
          current.publicStorageKey
        );
      }
      const deleted = await deleteSponsorMediaAsset(dbPool, {
        assetId: parsed.assetId,
        expectedVersion: parsed.expectedVersion,
        allowApproved: true
      });
      if (deleted.status !== 'updated' || !deleted.asset) {
        if (removedPublicObject && current.publicStorageKey) {
          await sponsorMediaStorage
            .publishObject({
              privateKey: current.processedStorageKey,
              publicKey: current.publicStorageKey,
              contentType: 'image/webp'
            })
            .catch(() => undefined);
        }
        writeSponsorMediaMutationFailure(
          request,
          response,
          deleted.status === 'conflict'
            ? 'conflict'
            : deleted.status === 'approved_locked'
              ? 'approved_locked'
              : 'not_found'
        );
        return;
      }
      await deleteSponsorMediaObjects(deleted.asset, { includePublic: false });
      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'sponsorship.media.delete',
        entityType: 'sponsor_media_asset',
        entityId: deleted.asset.id,
        summary: 'Sponsor media deleted by an administrator.',
        metadata: {
          contributionId: deleted.asset.contributionId,
          kind: deleted.asset.kind,
          storageDriver: sponsorMediaStorage.driver
        }
      });
      const result: SponsorMediaDeleteResult = {
        deleted: true,
        assetId: deleted.asset.id
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to delete sponsor media for admin.', error);
      writeJson(request, response, 502, {
        error: 'Sponsor media could not be deleted.'
      });
    }
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

      const contentType = contentTypeForSponsorLogoFilename(filename);

      if (!SPONSOR_LOGO_FILENAME_PATTERN.test(filename) || !contentType) {
        writeJson(request, response, 404, {
          error: 'Sponsor logo was not found.'
        });
        return;
      }

      const logo = await sponsorLogoStorage.readLogo(filename);
      if (!logo) {
        writeJson(request, response, 404, {
          error: 'Sponsor logo was not found.'
        });
        return;
      }

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

      const deletedMediaObject = await deleteControlledSponsorLogoFile(
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
          deletedMediaObject,
          storageDriver: sponsorLogoStorage.driver
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
    routeMatches(request.url, '/reference-lookup', '/api/reference-lookup')
  ) {
    if (!hasDatabase) {
      writeJson(request, response, 503, {
        error: 'Reference lookup requires DATABASE_URL.'
      });
      return;
    }

    let parsed: Partial<PublicReferenceLookupRequest> | null;
    try {
      const body = await readBody(request, 4 * 1024);
      parsed = JSON.parse(body) as Partial<PublicReferenceLookupRequest> | null;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid reference lookup request body.'
      });
      return;
    }

    const publicReference = normalizeContributionPublicReference(
      parsed?.reference
    );
    if (!publicReference) {
      writeJson(request, response, 400, {
        error: 'A valid OpenG7 reference is required.'
      });
      return;
    }

    try {
      const lookup = await lookupPublicContributionReference(
        dbPool,
        publicReference
      );
      const result: PublicReferenceLookupResponse = lookup ?? {
        found: false,
        publicReference
      };

      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to look up public contribution reference.', error);
      writeJson(request, response, 502, {
        error: 'Reference lookup could not be completed.'
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

    // Legacy local fallback remains available. Acceptance opts into a local,
    // navigable Checkout and still confirms payment through the signed webhook.
    if (!stripe || (stripeApiHost && !navigableSimulatedCheckout)) {
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
      const publicReference = createContributionPublicReference();
      const checkoutCancelUrl = new URL(cancelUrl);
      checkoutCancelUrl.searchParams.set('reference', publicReference);
      const checkoutSuccessUrl = sponsorshipFollowupToken
        ? buildSponsorshipFollowupUrl(
            successUrl,
            sponsorshipFollowupToken,
            sponsorshipFollowupLocaleFromUrl(successUrl)
          )
        : buildContributionCheckoutSuccessUrl(successUrl, publicReference);
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
        cancel_url: checkoutCancelUrl.toString(),
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
    routeMatches(request.url, '/reference-recovery', '/api/reference-recovery')
  ) {
    if (!hasDatabase) {
      writeJson(request, response, 503, {
        error: 'Reference recovery requires DATABASE_URL.'
      });
      return;
    }

    let parsed: Partial<ReferenceRecoveryRequest> | null;
    try {
      const body = await readBody(request, 8 * 1024);
      parsed = JSON.parse(body) as Partial<ReferenceRecoveryRequest> | null;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid reference recovery request body.'
      });
      return;
    }

    const email = normalizeReferenceRecoveryEmail(parsed?.email);
    if (!email) {
      writeJson(request, response, 400, {
        error: 'A valid email address is required.'
      });
      return;
    }

    try {
      const references = await listContributionReferencesByEmail(dbPool, email);

      if (references.length > 0) {
        try {
          const notificationResult =
            await queueContributionReferenceRecoveryEmail(dbPool, {
              to: email,
              references,
              idempotencyKey: createReferenceRecoveryIdempotencyKey(email)
            });

          if (!notificationResult.queued && !notificationResult.sent) {
            console.warn(
              'Reference recovery email could not be queued or sent.'
            );
          }
        } catch {
          // A matching address must not be disclosed by a queue/SMTP failure.
          // Do not log the database error: it can contain private message data.
          console.error(
            'Reference recovery email could not be queued or sent.'
          );
        }
      }

      const result: ReferenceRecoveryResult = { accepted: true };
      writeJson(request, response, 202, result);
    } catch {
      console.error('Failed to process reference recovery request.');
      writeJson(request, response, 502, {
        error: 'Reference recovery request could not be processed.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/sponsorship-followup/recover',
      '/api/sponsorship-followup/recover'
    )
  ) {
    if (!dbPool) {
      writeJson(request, response, 503, { error: 'Recovery is unavailable.' });
      return;
    }
    let email: string;
    let locale: 'fr-CA' | 'en';
    try {
      const input = JSON.parse(await readBody(request, 8 * 1024));
      if (!hasOnlyKeys(input, ['email', 'locale']))
        throw new SponsorshipAccessError(400, 'validation');
      if (input.locale !== undefined && !['fr-CA', 'en'].includes(input.locale))
        throw new SponsorshipAccessError(400, 'validation');
      email = normalizeRecoveryEmail(input?.email);
      locale = input?.locale === 'en' ? 'en' : 'fr-CA';
    } catch {
      writeJson(request, response, 400, {
        error: 'A valid email is required.'
      });
      return;
    }
    try {
      await recoverSponsorshipAccess(dbPool, email, {
        baseUrl: publicBaseOrigin,
        ttlDays: sponsorshipFollowupTokenTtlDays,
        locale
      });
    } catch {
      // Same public response even if a matching dossier encounters a queue error.
      console.error('Sponsorship access recovery could not be queued.');
    }
    writeJson(request, response, 202, { accepted: true });
    return;
  }

  if (
    routeMatches(
      request.url,
      '/admin/sponsorships/followup-access',
      '/api/admin/sponsorships/followup-access'
    ) &&
    ['GET', 'POST'].includes(request.method ?? '')
  ) {
    if (!ensureAdminAccess(request, response)) return;
    if (!dbPool) {
      writeJson(request, response, 503, { error: 'Recovery is unavailable.' });
      return;
    }
    try {
      if (request.method === 'GET') {
        const id =
          new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
            'contributionId'
          ) ?? '';
        if (!isValidUuid(id))
          throw new SponsorshipAccessError(400, 'validation');
        writeJson(request, response, 200, {
          recipient: await getSponsorshipAccessRecipient(dbPool, id)
        });
      } else {
        const input = JSON.parse(await readBody(request, 8 * 1024));
        if (
          !input ||
          !isValidUuid(input.contributionId) ||
          !isValidUuid(input.requestId) ||
          input.confirmed !== true
        )
          throw new SponsorshipAccessError(400, 'validation');
        const recipient = normalizeRecoveryEmail(input.recipient);
        const result = await issueSponsorshipAccess(
          dbPool,
          input.contributionId,
          recipient,
          {
            baseUrl: publicBaseOrigin,
            ttlDays: sponsorshipFollowupTokenTtlDays,
            locale: input.locale === 'en' ? 'en' : 'fr-CA'
          },
          { actor: getAdminAuditActor(request), requestId: input.requestId }
        );
        writeJson(request, response, 200, result);
      }
    } catch (error) {
      writeJson(
        request,
        response,
        error instanceof SponsorshipAccessError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 503,
        {
          error: 'Access link could not be queued.',
          code:
            error instanceof SponsorshipAccessError ? error.code : 'unavailable'
        }
      );
    }
    return;
  }

  if (
    routeMatches(
      request.url,
      '/sponsorship-followup/draft',
      '/api/sponsorship-followup/draft'
    ) &&
    ['GET', 'POST'].includes(request.method ?? '')
  ) {
    if (!dbPool) {
      writeJson(request, response, 503, {
        error: 'Draft storage is unavailable.'
      });
      return;
    }
    try {
      const input =
        request.method === 'POST'
          ? JSON.parse(await readBody(request, 16 * 1024))
          : null;
      if (
        request.method === 'POST' &&
        !hasOnlyKeys(input, ['token', 'expectedRevision', 'data'])
      )
        throw new SponsorshipAccessError(400, 'validation');
      const token =
        request.method === 'POST'
          ? input?.token
          : new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
              'token'
            );
      if (!isValidFollowupToken(token))
        throw new SponsorshipAccessError(404, 'access');
      const result =
        request.method === 'GET'
          ? await getSponsorshipDraft(
              dbPool,
              token,
              sponsorshipFollowupTokenTtlDays
            )
          : await saveSponsorshipDraft(
              dbPool,
              token,
              sponsorshipFollowupTokenTtlDays,
              input?.expectedRevision,
              input?.data
            );
      writeJson(request, response, 200, result);
    } catch (error) {
      writeJson(
        request,
        response,
        error instanceof SponsorshipAccessError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 503,
        {
          error: 'Draft operation failed.',
          code:
            error instanceof SponsorshipAccessError ? error.code : 'unavailable'
        }
      );
    }
    return;
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

    if (
      !isSafeSponsorshipText(parsed.companyName) ||
      parsed.companyName.length > SPONSOR_TEXT_MAX_LENGTH ||
      !isNonEmptySponsorText(parsed.companyName, SPONSOR_TEXT_MAX_LENGTH)
    ) {
      writeJson(request, response, 400, {
        error: 'Company name is required.'
      });
      return;
    }

    if (
      !isSafeSponsorshipText(parsed.contactName) ||
      parsed.contactName.length > SPONSOR_TEXT_MAX_LENGTH ||
      !isNonEmptySponsorText(parsed.contactName, SPONSOR_TEXT_MAX_LENGTH)
    ) {
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
      (!isSafeSponsorshipText(parsed.message, true) ||
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
      const followup = await getFreshSponsorshipFollowupByToken(token);

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

    const logo = parseSponsorLogoUpload(
      parts,
      contributionId,
      sponsorLogoMaxBytes
    );
    if (!logo) {
      writeJson(request, response, 400, {
        error: 'Sponsor logo must be a valid PNG, JPEG, or WebP image.'
      });
      return;
    }

    if (!SPONSOR_LOGO_FILENAME_PATTERN.test(logo.filename)) {
      writeJson(request, response, 400, {
        error: 'Sponsor logo filename is invalid.'
      });
      return;
    }

    const logoUrl = sponsorLogoPublicUrlForFilename(logo.filename);

    try {
      await sponsorLogoStorage.writeLogo({
        filename: logo.filename,
        data: logo.data,
        contentType: logo.mimeType
      });

      const updateResult = await updateSponsorshipLogoUrl(dbPool, {
        contributionId,
        logoUrl,
        expectedVersion
      });

      if (!updateResult.updated) {
        await sponsorLogoStorage
          .deleteLogo(logo.filename)
          .catch(() => undefined);
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

      const replacedMediaObject = await deleteControlledSponsorLogoFile(
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
          replacedMediaObject,
          storageDriver: sponsorLogoStorage.driver,
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
      const body = await readBody(request, 16 * 1024);
      parsed = JSON.parse(body) as SponsorshipFollowupDetailsRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship follow-up request body.'
      });
      return;
    }

    if (
      !hasOnlyKeys(parsed, [
        'token',
        'draftRevision',
        'companyName',
        'contactName',
        'contactEmail',
        'websiteUrl',
        'logoUrl',
        'message'
      ]) ||
      !isValidFollowupToken(parsed.token)
    ) {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship follow-up token.'
      });
      return;
    }

    if (
      !isSafeSponsorshipText(parsed.companyName) ||
      parsed.companyName.length > SPONSOR_TEXT_MAX_LENGTH ||
      !isNonEmptySponsorText(parsed.companyName, SPONSOR_TEXT_MAX_LENGTH)
    ) {
      writeJson(request, response, 400, {
        error: 'Company name is required.'
      });
      return;
    }

    if (
      !isSafeSponsorshipText(parsed.contactName) ||
      parsed.contactName.length > SPONSOR_TEXT_MAX_LENGTH ||
      !isNonEmptySponsorText(parsed.contactName, SPONSOR_TEXT_MAX_LENGTH)
    ) {
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
      (!isSafeSponsorshipText(parsed.message, true) ||
        parsed.message.length > SPONSOR_MESSAGE_MAX_LENGTH)
    ) {
      writeJson(request, response, 400, {
        error: 'Message is too long.'
      });
      return;
    }

    try {
      const followup = await getFreshSponsorshipFollowupByToken(parsed.token);

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

      const recorded = await submitSponsorshipDraft(
        dbPool!,
        parsed.token,
        sponsorshipFollowupTokenTtlDays,
        parsed.draftRevision,
        {
          companyName,
          contactName,
          contactEmail,
          websiteUrl: websiteUrl ?? '',
          logoUrl: logoUrl ?? '',
          message: message ?? ''
        }
      );

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

      const result: SponsorshipDetailsResult = { received: true, recorded };
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to record sponsorship follow-up details.');
      writeJson(
        request,
        response,
        error instanceof SponsorshipAccessError ? error.status : 502,
        {
          error: 'Sponsorship follow-up details could not be recorded.',
          code:
            error instanceof SponsorshipAccessError ? error.code : 'unavailable'
        }
      );
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
      publicBaseUrl: publicBaseUrl ?? publicBaseOrigin,
      projectId
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

  if (routeMatches(request.url, '/admin/backups', '/api/admin/backups')) {
    response.setHeader('Cache-Control', 'private, no-store');
    if (!ensureAdminAccess(request, response) || !dbPool) return;
    if (
      !['oidc', 'session'].includes(
        resolveAdminAuthorization(request)?.source ?? ''
      )
    ) {
      writeJson(request, response, 401, { code: 'ADMIN_SESSION_REQUIRED' });
      return;
    }
    if (
      request.method === 'POST' &&
      request.headers.origin &&
      ![publicBaseOrigin, ...allowedOrigins].includes(request.headers.origin)
    ) {
      writeJson(request, response, 403, { code: 'ORIGIN_FORBIDDEN' });
      return;
    }
    try {
      if (request.method === 'GET') {
        const id = new URL(
          request.url ?? '/',
          publicBaseOrigin
        ).searchParams.get('requestId');
        if (id !== null && !isBackupId(id))
          throw new BackupError('INVALID_BACKUP_REQUEST', 400);
        writeJson(
          request,
          response,
          200,
          await backupStatus(dbPool, id ?? undefined)
        );
      } else if (request.method === 'POST') {
        if (
          request.headers['content-type']
            ?.split(';')[0]
            .trim()
            .toLowerCase() !== 'application/json'
        )
          throw new BackupError('INVALID_BACKUP_REQUEST', 415);
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(await readBody(request, 2048));
          if (
            !input ||
            Array.isArray(input) ||
            !isBackupId(input.requestId) ||
            Object.keys(input).some(
              (key) => !['requestId', 'confirmation'].includes(key)
            )
          )
            throw new Error();
        } catch {
          throw new BackupError('INVALID_BACKUP_REQUEST', 400);
        }
        if (input.confirmation !== 'BACKUP_DATABASE')
          throw new BackupError('CONFIRMATION_REQUIRED', 400);
        const job = await requestBackup(
          dbPool,
          input.requestId as string,
          getAdminAuditActor(request)
        );
        writeJson(request, response, 202, job);
      } else {
        response.setHeader('Allow', 'GET, POST');
        writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
      }
    } catch (error) {
      writeJson(
        request,
        response,
        error instanceof BackupError ? error.status : 503,
        {
          code: error instanceof BackupError ? error.code : 'BACKUP_UNAVAILABLE'
        }
      );
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(request.url, '/admin/setup-status', '/api/admin/setup-status')
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
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

  if (await handleAdminEmailRequest(request, response)) {
    return;
  }

  if (await handleAdminDocumentsRequest(request, response)) return;

  const publicSponsorMediaId =
    request.method === 'GET'
      ? routeAssetId(
          request.url,
          '/public/sponsor-media/',
          '/api/public/sponsor-media/'
        )
      : null;
  if (publicSponsorMediaId) {
    try {
      const asset = await getApprovedPublicSponsorMedia(
        dbPool,
        publicSponsorMediaId
      );
      const image = asset?.publicStorageKey
        ? await sponsorMediaStorage.readPublicObject(asset.publicStorageKey)
        : null;
      if (!asset || !image) {
        writeJson(request, response, 404, { error: 'Not found' });
        return;
      }
      writeBinary(request, response, 200, image, 'image/webp', {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      console.error('Failed to serve public sponsor media.', error);
      writeJson(request, response, 404, { error: 'Not found' });
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

      const contentType = contentTypeForSponsorLogoFilename(filename);
      const publicLogoUrl = sponsorLogoPublicUrlForFilename(filename);

      if (!SPONSOR_LOGO_FILENAME_PATTERN.test(filename) || !contentType) {
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

        const logo = await sponsorLogoStorage.readLogo(filename);
        if (!logo) {
          writeJson(request, response, 404, { error: 'Not found' });
          return;
        }

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

  if (await handleAdminInsightsRequest(request, response)) return;

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/progress',
      '/api/admin/sponsorships/progress'
    )
  ) {
    if (!ensureAdminAuthorization(request, response)) return;
    const id = new URL(request.url!, 'http://localhost').searchParams.get(
      'sponsorshipId'
    );
    if (id !== null && !isValidUuid(id)) {
      writeJson(request, response, 400, { error: 'Invalid sponsorship ID.' });
      return;
    }
    try {
      writeJson(
        request,
        response,
        200,
        await getSponsorshipProgress(dbPool, id ?? undefined),
        { 'Cache-Control': 'private, no-store' }
      );
    } catch {
      writeJson(
        request,
        response,
        503,
        { error: 'Sponsorship progress unavailable.' },
        { 'Cache-Control': 'private, no-store' }
      );
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/assistant/context',
      '/api/admin/assistant/context'
    )
  ) {
    if (!ensureAdminAuthorization(request, response)) return;
    const id = new URL(request.url!, 'http://localhost').searchParams.get(
      'sponsorshipId'
    );
    if (id !== null && !isValidUuid(id)) {
      writeJson(request, response, 400, { error: 'Invalid sponsorship ID.' });
      return;
    }
    try {
      const result = await getAdminAssistantContext(
        dbPool,
        id ?? undefined,
        adminAssistantConfig.enabled && adminAssistantConfig.providerConfigured
          ? adminAssistantConfig.provider
          : 'disabled'
      );
      writeJson(request, response, 200, result, {
        'Cache-Control': 'private, no-store'
      });
    } catch {
      writeJson(
        request,
        response,
        503,
        { error: 'Assistant context unavailable.' },
        { 'Cache-Control': 'private, no-store' }
      );
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/request-information',
      '/api/admin/sponsorships/request-information'
    )
  ) {
    if (!ensureAdminAccess(request, response)) return;
    try {
      let input;
      try {
        input = validateInformationRequest(
          JSON.parse(await readBody(request, 32 * 1024))
        );
      } catch {
        throw new InformationRequestError(400);
      }
      const result = await requestSponsorshipInformation(
        dbPool!,
        input,
        getAdminAuditActor(request)
      );
      writeJson(request, response, 200, result, {
        'Cache-Control': 'private, no-store'
      });
    } catch (error) {
      writeJson(
        request,
        response,
        error instanceof InformationRequestError ? error.status : 503,
        {
          error:
            'Information request could not be queued. Refresh the record before trying again.'
        },
        { 'Cache-Control': 'private, no-store' }
      );
    }
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/assistant/summary',
      '/api/admin/assistant/summary'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    const startedAt = Date.now();
    try {
      const summary = await buildAdminAssistantSummary(dbPool);
      await recordAdminAssistantAudit(request, 'admin_assistant.summary', {
        urgent: summary.counts.urgent,
        today: summary.counts.today,
        itemCount: summary.attentionItems.length,
        durationMs: Date.now() - startedAt
      });
      writeJson(request, response, 200, summary);
    } catch (error) {
      console.error('Failed to build admin assistant summary.', error);
      writeJson(request, response, 502, {
        error: 'Admin assistant summary could not be built.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/assistant/query',
      '/api/admin/assistant/query'
    )
  ) {
    if (!ensureAdminAuthorization(request, response)) {
      return;
    }

    let parsed: AdminAssistantQueryRequest;
    try {
      const body = await readBody(request, 16 * 1024);
      parsed = body.trim()
        ? (JSON.parse(body) as AdminAssistantQueryRequest)
        : ({} as AdminAssistantQueryRequest);
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid assistant query body.'
      });
      return;
    }

    const message =
      typeof parsed?.message === 'string' ? parsed.message.trim() : '';
    if (
      parsed?.sponsorshipId !== undefined &&
      !isValidUuid(parsed.sponsorshipId)
    ) {
      writeJson(request, response, 400, { error: 'Invalid sponsorship ID.' });
      return;
    }
    if (!message) {
      writeJson(request, response, 400, {
        error: 'A question is required.'
      });
      return;
    }
    if (message.length > adminAssistantConfig.maxMessageLength) {
      writeJson(request, response, 400, {
        error: 'The question is too long.'
      });
      return;
    }

    const startedAt = Date.now();
    try {
      const result = await runAdminAssistantQuery({
        pool: dbPool,
        message,
        sponsorshipId: parsed.sponsorshipId,
        config: adminAssistantConfig
      });
      await recordAdminAssistantAudit(request, 'admin_assistant.query', {
        status: result.status,
        mode: result.mode,
        provider: result.provider.name,
        model: result.provider.model,
        toolCalls: result.toolInvocations.length,
        durationMs: Date.now() - startedAt
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to run admin assistant query.', error);
      writeJson(request, response, 502, {
        error: 'Admin assistant query could not be completed.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/assistant/prepare',
      '/api/admin/assistant/prepare'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminAssistantPrepareRequest;
    try {
      const body = await readBody(request, 16 * 1024);
      parsed = body.trim()
        ? (JSON.parse(body) as AdminAssistantPrepareRequest)
        : ({} as AdminAssistantPrepareRequest);
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid assistant prepare body.'
      });
      return;
    }

    const allowedDraftTypes: readonly AdminAssistantDraftType[] = [
      'sponsorship_reminder',
      'publication_draft',
      'admin_note',
      'slot_proposal'
    ];
    if (
      !allowedDraftTypes.includes(parsed?.type) ||
      (parsed.language !== undefined &&
        parsed.language !== 'fr-CA' &&
        parsed.language !== 'en')
    ) {
      writeJson(request, response, 400, {
        error: 'A valid draft type is required.'
      });
      return;
    }

    const reference =
      typeof parsed.reference === 'string'
        ? parsed.reference.trim().slice(0, 64)
        : undefined;

    const startedAt = Date.now();
    try {
      const result = await prepareAdminAssistantDraft(dbPool, {
        type: parsed.type,
        reference,
        language: parsed.language
      });
      await recordAdminAssistantAudit(request, 'admin_assistant.prepare', {
        draftType: parsed.type,
        status: result.status,
        durationMs: Date.now() - startedAt
      });
      writeJson(request, response, 200, result, {
        'Cache-Control': 'private, no-store'
      });
    } catch (error) {
      console.error('Failed to prepare admin assistant draft.', error);
      writeJson(request, response, 502, {
        error: 'Admin assistant draft could not be prepared.'
      });
    }
    return;
  }

  if (await handleAdminContributionsRequest(request, response)) return;

  if (await handleAdminAccountingRequest(request, response)) return;

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
      const result = await listAdminPublicationDrafts(dbPool, {
        id:
          new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
            'draftId'
          ) ?? undefined
      });
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
      '/admin/publication-slots',
      '/api/admin/publication-slots'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const result = await listAdminPublicationSlots(dbPool, {
        id:
          new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
            'slotId'
          ) ?? undefined
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load publication slots.', error);
      writeJson(request, response, 502, {
        error: 'Publication slots could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-slots',
      '/api/admin/publication-slots'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationSlotCreateRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationSlotCreateRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot request body.'
      });
      return;
    }

    if (!isAllowedSponsorFeedTarget(parsed.feedTarget)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot target.'
      });
      return;
    }

    if (!isAllowedSponsorFeedChannel(parsed.channel)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot channel.'
      });
      return;
    }

    if (!isFutureDateString(parsed.startsAt)) {
      writeJson(request, response, 400, {
        error: 'Publication slot date must be a future date.'
      });
      return;
    }

    if (
      parsed.timezone !== undefined &&
      !isValidPublicationSlotTimezone(parsed.timezone)
    ) {
      writeJson(request, response, 400, {
        error: 'Publication slot timezone is invalid.'
      });
      return;
    }

    if (!isValidPublicationBatchCapacity(parsed.capacity)) {
      writeJson(request, response, 400, {
        error: `Publication slot capacity must be an integer between ${PUBLICATION_BATCH_MIN_CAPACITY} and ${PUBLICATION_BATCH_MAX_CAPACITY}.`
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
        error: 'Publication slot notes are too long.'
      });
      return;
    }

    try {
      const result = await createAdminPublicationSlot(dbPool, {
        ...parsed,
        startsAt: new Date(parsed.startsAt).toISOString(),
        timezone: normalizePublicationSlotTimezone(parsed.timezone)
      });
      if (!result.updated || !result.slot) {
        writeJson(request, response, 404, {
          error: 'Publication slots migration is missing.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_slot.create',
        entityType: 'publication_slot',
        entityId: result.slot.id,
        summary: `Publication slot created for ${channelLabel(result.slot.channel)} at ${result.slot.startsAt}.`,
        metadata: {
          feedTarget: result.slot.feedTarget,
          channel: result.slot.channel,
          startsAt: result.slot.startsAt,
          timezone: result.slot.timezone,
          capacity: result.slot.capacity
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to create publication slot.', error);
      writeJson(request, response, 502, {
        error: 'Publication slot could not be created.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-slots/update',
      '/api/admin/publication-slots/update'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationSlotUpdateRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationSlotUpdateRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot update request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.slotId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot id.'
      });
      return;
    }

    if (parsed.startsAt !== undefined && !isFutureDateString(parsed.startsAt)) {
      writeJson(request, response, 400, {
        error: 'Publication slot date must be a future date.'
      });
      return;
    }

    if (
      parsed.timezone !== undefined &&
      !isValidPublicationSlotTimezone(parsed.timezone)
    ) {
      writeJson(request, response, 400, {
        error: 'Publication slot timezone is invalid.'
      });
      return;
    }

    if (
      parsed.capacity !== undefined &&
      !isValidPublicationBatchCapacity(parsed.capacity)
    ) {
      writeJson(request, response, 400, {
        error: `Publication slot capacity must be an integer between ${PUBLICATION_BATCH_MIN_CAPACITY} and ${PUBLICATION_BATCH_MAX_CAPACITY}.`
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
        error: 'Publication slot notes are too long.'
      });
      return;
    }

    try {
      const result = await updateAdminPublicationSlot(dbPool, {
        ...parsed,
        startsAt:
          parsed.startsAt !== undefined
            ? new Date(parsed.startsAt).toISOString()
            : undefined,
        timezone:
          parsed.timezone !== undefined
            ? normalizePublicationSlotTimezone(parsed.timezone)
            : undefined
      });
      if (!result.updated || !result.slot) {
        writeJson(request, response, 409, {
          error:
            'Publication slot was not found, is final, is in the past, or capacity would be exceeded.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_slot.update',
        entityType: 'publication_slot',
        entityId: result.slot.id,
        summary: `Publication slot updated for ${channelLabel(result.slot.channel)} at ${result.slot.startsAt}.`,
        metadata: {
          startsAt: result.slot.startsAt,
          timezone: result.slot.timezone,
          capacity: result.slot.capacity,
          capacityUsed: result.slot.capacityUsed
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to update publication slot.', error);
      writeJson(request, response, 502, {
        error: 'Publication slot could not be updated.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-slots/assign-batch',
      '/api/admin/publication-slots/assign-batch'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationSlotAssignBatchRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationSlotAssignBatchRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot batch assignment request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.slotId) || !isValidUuid(parsed.batchId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot or batch id.'
      });
      return;
    }

    try {
      const result = await assignBatchToPublicationSlot(dbPool, parsed);
      if (!result.updated || !result.slot) {
        writeJson(request, response, 409, {
          error:
            'Batch could not be assigned: it must match the slot channel and target, stay within capacity, and not already belong to another slot.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_slot.assign_batch',
        entityType: 'publication_slot',
        entityId: result.slot.id,
        summary: `Batch assigned to publication slot ${result.slot.startsAt}.`,
        metadata: { slotId: parsed.slotId, batchId: parsed.batchId }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to assign batch to publication slot.', error);
      writeJson(request, response, 502, {
        error: 'Batch could not be assigned to the publication slot.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-slots/assign-draft',
      '/api/admin/publication-slots/assign-draft'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationSlotAssignDraftRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationSlotAssignDraftRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot draft assignment request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.slotId) || !isValidUuid(parsed.draftId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot or draft id.'
      });
      return;
    }

    try {
      const result = await assignDraftToPublicationSlot(dbPool, parsed);
      if (!result.updated || !result.slot) {
        writeJson(request, response, 409, {
          error:
            'Draft could not be assigned: it must be approved, unbatched, match the slot target/channel, and fit remaining capacity.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_slot.assign_draft',
        entityType: 'publication_slot',
        entityId: result.slot.id,
        summary: `Draft assigned directly to publication slot ${result.slot.startsAt}.`,
        metadata: { slotId: parsed.slotId, draftId: parsed.draftId }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to assign draft to publication slot.', error);
      writeJson(request, response, 502, {
        error: 'Draft could not be assigned to the publication slot.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-slots/publish',
      '/api/admin/publication-slots/publish'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationSlotLifecycleRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationSlotLifecycleRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.slotId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot id.'
      });
      return;
    }

    try {
      const result = await publishAdminPublicationSlot(dbPool, parsed);
      if (!result.updated || !result.slot) {
        writeJson(request, response, 409, {
          error:
            'Publication slot was not found, is not scheduled, or has no assigned drafts.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_slot.publish',
        entityType: 'publication_slot',
        entityId: result.slot.id,
        summary: `Publication slot published (${result.slot.assignedDraftIds.length} draft(s)).`,
        metadata: {
          channel: result.slot.channel,
          feedTarget: result.slot.feedTarget,
          assignedDraftIds: result.slot.assignedDraftIds
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to publish publication slot.', error);
      writeJson(request, response, 502, {
        error: 'Publication slot could not be published.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-slots/cancel',
      '/api/admin/publication-slots/cancel'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    let parsed: AdminPublicationSlotLifecycleRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as AdminPublicationSlotLifecycleRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.slotId)) {
      writeJson(request, response, 400, {
        error: 'Invalid publication slot id.'
      });
      return;
    }

    try {
      const result = await cancelAdminPublicationSlot(dbPool, parsed);
      if (!result.updated || !result.slot) {
        writeJson(request, response, 409, {
          error: 'Publication slot was not found or is already final.'
        });
        return;
      }

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: 'publication_slot.cancel',
        entityType: 'publication_slot',
        entityId: result.slot.id,
        summary: `Publication slot cancelled (${channelLabel(result.slot.channel)}).`,
        metadata: {
          channel: result.slot.channel,
          feedTarget: result.slot.feedTarget
        }
      });
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to cancel publication slot.', error);
      writeJson(request, response, 502, {
        error: 'Publication slot could not be cancelled.'
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
      const result = await listAdminPublicationBatches(dbPool, {
        id:
          new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
            'batchId'
          ) ?? undefined
      });
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
      !isFutureDateString(parsed.scheduledAt)
    ) {
      writeJson(request, response, 400, {
        error: 'Publication batch scheduled date must be a future date.'
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
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/admin/social-publication-jobs',
      '/api/admin/social-publication-jobs'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    try {
      const result = await listAdminSocialPublicationJobs(
        dbPool,
        socialPublicationRuntime()
      );
      writeJson(request, response, 200, result);
    } catch (error) {
      console.error('Failed to load social publication jobs.', error);
      writeJson(request, response, 502, {
        error: 'Social publication jobs could not be loaded.'
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/publication-batches/publish-social',
      '/api/admin/publication-batches/publish-social'
    )
  ) {
    if (!ensureAdminAccess(request, response)) return;
    writeJson(request, response, 409, {
      code: 'FINAL_APPROVAL_REQUIRED',
      error:
        'Prepare and approve the exact publication in /admin/fundraiser/publications/automation.'
    });
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
      const entryId = new URL(
        request.url ?? '/',
        'http://localhost'
      ).searchParams.get('entryId');
      response.setHeader('Cache-Control', 'no-store');
      if (entryId !== null && !isValidUuid(entryId)) {
        writeJson(request, response, 400, { error: 'Invalid entryId.' });
        return;
      }
      const result = await listAdminAuditLog(dbPool, entryId ?? undefined);
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
    routeMatches(
      request.url,
      '/admin/sponsorships/details',
      '/api/admin/sponsorships/details'
    )
  ) {
    if (!ensureAdminAccess(request, response)) return;
    response.setHeader('Cache-Control', 'private, no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      writeJson(request, response, 405, { error: 'Method not allowed.' });
      return;
    }
    if (
      request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
      'application/json'
    ) {
      writeJson(request, response, 415, { error: 'JSON body required.' });
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(await readBody(request, 16 * 1024));
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship details request.'
      });
      return;
    }
    try {
      const result = await updateAdminSponsorshipDetails(
        dbPool!,
        input,
        getAdminAuditActor(request)
      );
      writeJson(request, response, 200, result);
    } catch (error) {
      writeJson(
        request,
        response,
        error instanceof SponsorshipDetailsError ? error.status : 503,
        { error: 'Sponsorship details could not be updated.' }
      );
    }
    return;
  }

  if (
    routeMatches(
      request.url,
      '/admin/sponsorships/interventions',
      '/api/admin/sponsorships/interventions'
    )
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    if (!ensureAdminAccess(request, response)) return;
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      writeJson(request, response, 405, { error: 'Method not allowed.' });
      return;
    }
    try {
      if (request.method === 'GET') {
        const params = new URL(request.url!, 'http://localhost').searchParams;
        writeJson(
          request,
          response,
          200,
          await getSponsorshipInterventions(
            dbPool!,
            params.get('sponsorshipId'),
            params.get('before')
          )
        );
      } else {
        if (
          request.headers['content-type']
            ?.split(';')[0]
            .trim()
            .toLowerCase() !== 'application/json'
        ) {
          writeJson(request, response, 415, { error: 'JSON body required.' });
          return;
        }
        let input: unknown;
        try {
          input = JSON.parse(await readBody(request, 16 * 1024));
        } catch {
          throw new SponsorshipInterventionError(400);
        }
        writeJson(
          request,
          response,
          200,
          await recordSponsorshipIntervention(
            dbPool!,
            input,
            getAdminAuditActor(request)
          )
        );
      }
    } catch (error) {
      writeJson(
        request,
        response,
        error instanceof SponsorshipInterventionError ? error.status : 503,
        {
          code: 'SPONSORSHIP_INTERVENTION_FAILED',
          error: 'Sponsorship interventions could not be processed.'
        }
      );
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

    const reviewNote =
      typeof parsed.reviewNote === 'string' ? parsed.reviewNote.trim() : '';
    const isRejection = parsed.reviewStatus === 'rejected';
    const notifySponsor = isRejection && parsed.notifySponsor !== false;
    const notificationEmail =
      typeof parsed.notificationEmail === 'string'
        ? parsed.notificationEmail.trim()
        : '';
    const sponsorMessage =
      typeof parsed.sponsorMessage === 'string'
        ? parsed.sponsorMessage.trim()
        : '';
    const refundHandling: AdminSponsorshipRejectionRefundHandling = isRejection
      ? (parsed.refundHandling ?? 'none')
      : 'none';
    const refundNote =
      typeof parsed.refundNote === 'string' ? parsed.refundNote.trim() : '';

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

    if (isRejection && !reviewNote) {
      writeJson(request, response, 400, {
        error: 'A rejection reason is required.'
      });
      return;
    }

    if (
      !isValidOptionalBoundedText(
        parsed.sponsorMessage,
        SPONSOR_MESSAGE_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Sponsor notification message is too long.'
      });
      return;
    }

    if (
      !isValidOptionalBoundedText(
        parsed.refundNote,
        ADMIN_REVIEW_NOTE_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Refund note is too long.'
      });
      return;
    }

    if (
      isRejection &&
      !isAllowedSponsorshipRejectionRefundHandling(refundHandling)
    ) {
      writeJson(request, response, 400, {
        error: 'Invalid rejection refund handling.'
      });
      return;
    }

    if (notifySponsor && !isValidSponsorEmail(notificationEmail)) {
      writeJson(request, response, 400, {
        error: 'A valid sponsor notification email is required.'
      });
      return;
    }

    if (notifySponsor && !sponsorMessage) {
      writeJson(request, response, 400, {
        error: 'A sponsor-facing rejection message is required.'
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
        reviewNote: reviewNote || null,
        expectedVersion: parsed.expectedVersion
      });

      if (!updated.updated) {
        writeSponsorshipMutationFailure(request, response, updated.status, {
          currentVersion: updated.currentVersion,
          paymentStatus: updated.paymentStatus
        });
        return;
      }

      const refundWorkflowStatus =
        isRejection && refundHandling === 'manual_required'
          ? 'requested'
          : isRejection && refundHandling === 'manual_completed'
            ? 'completed'
            : undefined;
      if (refundWorkflowStatus) {
        await updateSponsorshipRefundWorkflowStatus(dbPool, {
          contributionId: parsed.contributionId,
          refundStatus: refundWorkflowStatus,
          refundNote: refundNote || null
        });
      }

      const updatedSponsorship = isRejection
        ? await getAdminSponsorshipById(dbPool, parsed.contributionId)
        : null;
      const notificationResult =
        notifySponsor && updatedSponsorship
          ? await queueSponsorshipRejectionEmail(dbPool, {
              to: notificationEmail,
              contributionId: parsed.contributionId,
              publicReference: updatedSponsorship.public_reference,
              sponsorName:
                updatedSponsorship.sponsor_company_name ??
                updatedSponsorship.public_name ??
                'commanditaire',
              amount: updatedSponsorship.amount,
              currency: updatedSponsorship.currency,
              reviewReason: reviewNote,
              sponsorMessage,
              refundHandling,
              refundNote: refundNote || undefined,
              idempotencyKey: `sponsorship-rejection:${parsed.contributionId}:${updated.currentVersion}`
            })
          : null;

      const result: AdminSponsorshipReviewResult = {
        updated: updated.updated,
        reviewStatus: parsed.reviewStatus,
        ...(isRejection ? { refundHandling } : {}),
        ...(refundWorkflowStatus ? { refundWorkflowStatus } : {}),
        ...(notificationResult
          ? {
              notification: {
                queued: notificationResult.queued,
                attempted: notificationResult.attempted,
                sent: notificationResult.sent,
                messageId: notificationResult.messageId,
                error: notificationResult.error
              }
            }
          : {})
      };
      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: `sponsorship_review.${parsed.reviewStatus}`,
        entityType: 'sponsorship',
        entityId: parsed.contributionId,
        summary: `Sponsorship review set to ${parsed.reviewStatus}.`,
        metadata: {
          reviewStatus: parsed.reviewStatus,
          hasReviewNote: Boolean(reviewNote),
          ...(isRejection
            ? {
                notifySponsor,
                notificationEmail: notifySponsor ? notificationEmail : null,
                notificationMessageId: notificationResult?.messageId ?? null,
                notificationSent: notificationResult?.sent ?? false,
                notificationError: notificationResult?.error ?? null,
                refundHandling,
                refundWorkflowStatus: refundWorkflowStatus ?? null,
                hasRefundNote: Boolean(refundNote)
              }
            : {})
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
      '/admin/sponsorships/refund',
      '/api/admin/sponsorships/refund'
    )
  ) {
    if (!ensureAdminAccess(request, response)) {
      return;
    }

    if (!stripe && isProduction) {
      writeJson(request, response, 503, {
        error: 'Stripe is not configured.'
      });
      return;
    }

    let parsed: Partial<AdminSponsorshipRefundRequest>;
    try {
      const body = await readBody(request);
      const candidate = JSON.parse(body) as unknown;
      if (!candidate || typeof candidate !== 'object') {
        throw new Error('Invalid sponsorship refund request body.');
      }
      parsed = candidate as Partial<AdminSponsorshipRefundRequest>;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid sponsorship refund request body.'
      });
      return;
    }

    if (!isValidUuid(parsed.contributionId)) {
      writeJson(request, response, 400, {
        error: 'Invalid contribution id.'
      });
      return;
    }

    if (!isValidAdminExpectedVersion(parsed.expectedVersion)) {
      writeJson(request, response, 400, {
        error: 'Sponsorship version is required.'
      });
      return;
    }

    if (
      typeof parsed.confirmationText !== 'string' ||
      parsed.confirmationText.trim().length === 0
    ) {
      writeJson(request, response, 400, {
        error: 'Confirmation text is required.'
      });
      return;
    }

    const notifySponsor = parsed.notifySponsor === true;
    const notificationEmail =
      typeof parsed.notificationEmail === 'string'
        ? parsed.notificationEmail.trim()
        : '';
    const sponsorMessage =
      typeof parsed.sponsorMessage === 'string'
        ? parsed.sponsorMessage.trim()
        : '';
    const refundNote =
      typeof parsed.refundNote === 'string' ? parsed.refundNote.trim() : '';
    const refundReason =
      parsed.refundReason === undefined
        ? 'requested_by_customer'
        : parsed.refundReason;

    if (!isAllowedSponsorshipStripeRefundReason(refundReason)) {
      writeJson(request, response, 400, {
        error: 'Invalid Stripe refund reason.'
      });
      return;
    }

    if (
      parsed.amount !== undefined &&
      (typeof parsed.amount !== 'number' || !Number.isFinite(parsed.amount))
    ) {
      writeJson(request, response, 400, {
        error: 'Refund amount must be a number.'
      });
      return;
    }

    if (
      !isValidOptionalBoundedText(
        parsed.refundNote,
        ADMIN_REVIEW_NOTE_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Refund note is too long.'
      });
      return;
    }

    if (
      !isValidOptionalBoundedText(
        parsed.sponsorMessage,
        SPONSOR_MESSAGE_MAX_LENGTH
      )
    ) {
      writeJson(request, response, 400, {
        error: 'Sponsor notification message is too long.'
      });
      return;
    }

    if (notifySponsor && !isValidSponsorEmail(notificationEmail)) {
      writeJson(request, response, 400, {
        error: 'A valid sponsor notification email is required.'
      });
      return;
    }

    if (notifySponsor && !sponsorMessage) {
      writeJson(request, response, 400, {
        error: 'A sponsor-facing refund message is required.'
      });
      return;
    }

    let refundOperationId: string | null = null;
    let stripeRefundCreated = false;
    const refundWorkflowNote = refundNote || null;

    try {
      const target = await getSponsorshipRefundTarget(
        dbPool,
        parsed.contributionId
      );
      if (!target) {
        writeJson(request, response, 404, {
          error: 'Sponsorship contribution was not found.'
        });
        return;
      }

      if (target.version !== parsed.expectedVersion) {
        writeJson(request, response, 409, {
          code: 'SPONSORSHIP_CONCURRENT_UPDATE',
          message:
            'Cette commandite a ete modifiee par un autre administrateur.',
          currentVersion: target.version
        });
        return;
      }

      if (target.paymentStatus !== 'paid') {
        writeSponsorshipRefundIneligible(
          request,
          response,
          target.paymentStatus
        );
        return;
      }

      if (
        target.refundWorkflowStatus === 'processing' ||
        (target.refundWorkflowStatus === 'completed' && !target.refundId)
      ) {
        writeJson(request, response, 409, {
          code: 'SPONSORSHIP_REFUND_NOT_ELIGIBLE',
          message:
            target.refundWorkflowStatus === 'completed'
              ? 'Cette commandite a deja un remboursement manuel marque comme complete.'
              : 'Un remboursement est deja en cours pour cette commandite.',
          paymentStatus: target.paymentStatus,
          refundWorkflowStatus: target.refundWorkflowStatus
        });
        return;
      }

      const requestedRefundAmountCents =
        parsed.amount === undefined
          ? target.amountCents
          : amountToCents(parsed.amount);
      const isFullRefund = requestedRefundAmountCents === target.amountCents;
      const hasValidCentPrecision =
        parsed.amount === undefined ||
        Math.abs(parsed.amount * 100 - requestedRefundAmountCents) < 0.000001;

      if (
        requestedRefundAmountCents <= 0 ||
        requestedRefundAmountCents > target.amountCents ||
        !hasValidCentPrecision
      ) {
        writeJson(request, response, 400, {
          error: `Refund amount must be between 0.01 and ${target.amount.toFixed(
            2
          )} ${target.currency}.`
        });
        return;
      }

      if (!target.stripePaymentIntentId) {
        writeJson(request, response, 409, {
          code: 'SPONSORSHIP_REFUND_NOT_ELIGIBLE',
          message: 'Aucun Payment Intent Stripe n est lie a cette commandite.',
          paymentStatus: target.paymentStatus
        });
        return;
      }

      const expectedConfirmation = sponsorshipRefundConfirmationText(target);
      if (parsed.confirmationText?.trim() !== expectedConfirmation) {
        writeJson(request, response, 400, {
          error: `Confirmation text must match ${expectedConfirmation}.`
        });
        return;
      }

      refundOperationId = await beginSponsorshipRefundOperation(dbPool!, {
        contributionId: target.id,
        expectedVersion: parsed.expectedVersion,
        paymentIntentId: target.stripePaymentIntentId,
        amountMinor: requestedRefundAmountCents,
        currency: target.currency,
        reason: refundReason,
        note: refundWorkflowNote,
        actor: getAdminAuditActor(request)
      });

      const refund = stripe
        ? await stripe.refunds.create(
            {
              amount: requestedRefundAmountCents,
              payment_intent: target.stripePaymentIntentId,
              reason: refundReason,
              metadata: {
                contributionId: target.id,
                refundType: isFullRefund ? 'full' : 'partial',
                refundAmountCents: String(requestedRefundAmountCents),
                refundReason,
                publicReference: target.publicReference ?? '',
                source: 'openg7_admin_sponsorship_refund',
                openg7RefundOperationId: refundOperationId
              }
            },
            {
              idempotencyKey: `sponsorship-refund:${refundOperationId}`
            }
          )
        : createDevelopmentRefundResult({
            amountCents: requestedRefundAmountCents,
            currency: target.currency,
            paymentIntentId: target.stripePaymentIntentId
          });
      stripeRefundCreated = true;
      await settleSponsorshipRefundOperation(dbPool, refund, refundOperationId);
      const refundWorkflowStatus =
        refund.status === 'succeeded'
          ? 'completed'
          : refund.status === 'failed' || refund.status === 'canceled'
            ? 'failed'
            : 'processing';
      const refundAttemptAccepted = refundWorkflowStatus !== 'failed';
      const refundCompleted = refundWorkflowStatus === 'completed';
      const paymentStatusUpdated = refundCompleted
        ? isFullRefund
          ? await updateContributionStatusByPaymentIntent(dbPool, {
              stripePaymentIntentId: target.stripePaymentIntentId,
              status: 'refunded'
            })
          : false
        : false;
      const refundAmount = Number((refund.amount / 100).toFixed(2));
      const refundCurrency = refund.currency.toUpperCase();
      let creditNote: Awaited<
        ReturnType<typeof createSponsorshipCreditNoteForRefund>
      > = null;
      let adminCreditNote: Awaited<
        ReturnType<typeof getAdminSponsorshipCreditNoteById>
      > = null;
      let creditNoteError: string | null = null;

      if (refundAttemptAccepted) {
        try {
          creditNote = await createSponsorshipCreditNoteForRefund(dbPool, {
            contributionId: target.id,
            stripeRefundId: refund.id,
            refundAmountCents: refund.amount
          });
          adminCreditNote = creditNote
            ? await getAdminSponsorshipCreditNoteById(dbPool, creditNote.id)
            : null;
        } catch (error) {
          creditNoteError =
            error instanceof Error
              ? error.message
              : 'Credit note could not be created.';
          console.error('Failed to create sponsorship credit note.', error);
        }
      }

      const notificationResult =
        refundAttemptAccepted && notifySponsor
          ? creditNote
            ? await queueSponsorshipCreditNoteEmail(dbPool, {
                to: notificationEmail,
                creditNote,
                sponsorMessage,
                idempotencyKey: `sponsorship-credit-note:${creditNote.id}:${refund.id}`
              })
            : await queueSponsorshipRefundEmail(dbPool, {
                to: notificationEmail,
                contributionId: target.id,
                publicReference: target.publicReference,
                sponsorName: target.sponsorName,
                amount: refundAmount,
                currency: refundCurrency,
                refundId: refund.id,
                refundStatus: refund.status,
                sponsorMessage,
                refundNote: refundNote || undefined,
                idempotencyKey: `sponsorship-refund-email:${target.id}:${refund.id}`
              })
          : null;

      await insertAdminAuditLog(dbPool, {
        actor: getAdminAuditActor(request),
        action: isFullRefund
          ? 'sponsorship_refund.stripe_full'
          : 'sponsorship_refund.stripe_partial',
        entityType: 'sponsorship',
        entityId: target.id,
        summary: `Stripe ${isFullRefund ? 'full' : 'partial'} refund ${
          refund.id
        } created for ${target.sponsorName}.`,
        metadata: {
          amount: refund.amount,
          currency: refund.currency,
          requestedAmount: requestedRefundAmountCents,
          fullRefund: isFullRefund,
          paymentIntentId: target.stripePaymentIntentId,
          publicReference: target.publicReference,
          refundId: refund.id,
          refundReason,
          refundNote: refundNote || null,
          refundStatus: refund.status,
          refundWorkflowStatus,
          paymentStatusUpdated,
          creditNoteId: creditNote?.id ?? null,
          creditNoteNumber: creditNote?.creditNoteNumber ?? null,
          creditNoteError,
          notifySponsor,
          notificationEmail: notifySponsor ? notificationEmail : null,
          notificationMessageId: notificationResult?.messageId ?? null,
          notificationSent: notificationResult?.sent ?? false,
          notificationError: notificationResult?.error ?? null
        }
      });

      const result: AdminSponsorshipRefundResult = {
        refunded: refundCompleted,
        refundId: refund.id,
        refundStatus: refund.status,
        refundWorkflowStatus,
        refundReason,
        fullRefund: isFullRefund,
        amount: refundAmount,
        currency: refundCurrency,
        contributionId: target.id,
        paymentStatusUpdated,
        sponsorship: await getAdminSponsorshipById(dbPool, target.id),
        creditNote: adminCreditNote,
        ...(notificationResult
          ? {
              notification: {
                queued: notificationResult.queued,
                attempted: notificationResult.attempted,
                sent: notificationResult.sent,
                messageId: notificationResult.messageId,
                error: notificationResult.error
              }
            }
          : {})
      };
      writeJson(request, response, 200, result);
    } catch (error) {
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : 'Sponsorship refund could not be created.';
      if (error instanceof SponsorshipRefundOperationError) {
        writeJson(request, response, 409, {
          code: error.code,
          error: 'Refund claim refused; refresh the sponsorship.'
        });
        return;
      }
      const definitive =
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.statusCode === 400 &&
        error.code !== 'idempotency_key_in_use';
      if (refundOperationId && !stripeRefundCreated) {
        try {
          await failSponsorshipRefundOperation(
            dbPool!,
            refundOperationId,
            definitive
          );
        } catch {
          console.error(
            'Failed to record Stripe refund outcome; operation remains blocked.'
          );
        }
      }
      const uncertain =
        refundOperationId && !stripeRefundCreated && !definitive;
      console.error('Sponsorship refund interrupted.', {
        operationId: refundOperationId,
        uncertain: Boolean(uncertain)
      });
      writeJson(request, response, 502, {
        ...(uncertain ? { code: 'SPONSORSHIP_REFUND_UNCERTAIN' } : {}),
        error: uncertain
          ? 'Resultat Stripe incertain. Ne relancez pas le remboursement; verifiez son etat avec Stripe.'
          : errorMessage
      });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(
      request.url,
      '/admin/sponsorships/website-visibility',
      '/api/admin/sponsorships/website-visibility'
    )
  ) {
    if (!ensureAdminAccess(request, response) || !dbPool) return;
    if (
      request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
      'application/json'
    ) {
      writeJson(request, response, 415, {
        code: 'WEBSITE_VISIBILITY_CONTENT_TYPE',
        error: 'JSON content type required.'
      });
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(await readBody(request));
    } catch {
      input = null;
    }
    if (!isSponsorshipWebsiteVisibilityRequest(input)) {
      writeJson(request, response, 400, {
        error: 'Invalid or unconfirmed website visibility decision.',
        code: 'WEBSITE_VISIBILITY_INVALID'
      });
      return;
    }
    try {
      const outcome = await setSponsorshipWebsiteVisibility(
        dbPool,
        input,
        getAdminAuditActor(request)
      );
      const status =
        outcome === 'not_found'
          ? 404
          : ['conflict', 'blocked'].includes(outcome)
            ? 409
            : 200;
      writeJson(request, response, status, {
        outcome,
        code: `WEBSITE_VISIBILITY_${outcome.toUpperCase()}`
      });
    } catch {
      writeJson(request, response, 503, {
        error: 'Website visibility could not be updated.',
        code: 'WEBSITE_VISIBILITY_UNAVAILABLE'
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
      const pagination = parsePublicSponsorshipPagination(
        new URL(request.url ?? '/', publicBaseOrigin).searchParams
      );
      if (!pagination) {
        writeJson(request, response, 400, {
          error: 'Invalid public sponsorship pagination.'
        });
        return;
      }
      const sponsorships = await listPublicSponsorships(dbPool, pagination);

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
    routeMatches(request.url, '/public/builders', '/api/public/builders')
  ) {
    const pagination = parsePublicDirectoryPagination(
      new URL(request.url ?? '/', publicBaseOrigin).searchParams,
      24
    );
    if (!pagination) {
      writeJson(request, response, 400, {
        error: 'Invalid public directory pagination.'
      });
      return;
    }
    try {
      writeJson(
        request,
        response,
        200,
        await listPublicBuilders(dbPool, pagination)
      );
    } catch {
      console.error('Failed to load public builders.');
      writeJson(request, response, 502, {
        error: 'Public builders could not be loaded.'
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
      allowed_contribution_amounts: [...allowedContributionAmounts],
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
        : readStripeTransparency
          ? await readStripeTransparency()
          : await getPublicTransparencySummary(null);

      writeJson(request, response, 200, summary);
    } catch (error) {
      console.error('Failed to build public fund transparency summary.', error);
      writeJson(request, response, 502, {
        error: 'Public fund transparency summary could not be loaded.'
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
};

createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    // Never log request bodies, tracking tokens or provider diagnostics here.
    console.error('Unhandled API request failure.');
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) response.destroy();
    else
      writeJson(request, response, 500, {
        code: 'INTERNAL_ERROR',
        error: 'The request could not be completed.'
      });
  });
}).listen(port, () => {
  console.log(`Funding API listening on http://localhost:${port}`);
  if (!hasDatabase) {
    console.info(
      'DATABASE_URL is not configured. Using Stripe-direct public transparency.'
    );
    return;
  }

  void runEmailQueueWorker();
  void runContributionActivity();
  const contributionTimer = setInterval(
    () => void runContributionActivity(),
    2000
  );
  contributionTimer.unref();
  void runPublicationWorker();
  const publicationTimer = setInterval(
    () => void runPublicationWorker(),
    30000
  );
  publicationTimer.unref();
  void runAdminSponsorshipReviewReminderWorker();
  const emailQueueTimer = setInterval(
    () => void runEmailQueueWorker(),
    emailQueuePollIntervalMs
  );
  emailQueueTimer.unref();
  const adminSponsorshipReviewReminderTimer = setInterval(
    () => void runAdminSponsorshipReviewReminderWorker(),
    adminSponsorshipReviewReminderConfig.pollIntervalMs
  );
  adminSponsorshipReviewReminderTimer.unref();
});
