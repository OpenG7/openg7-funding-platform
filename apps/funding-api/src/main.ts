import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import Stripe from 'stripe';
import type {
  AdminSetupStatusResponse,
  AdminSessionCreateRequest,
  AdminSponsorshipStripeRefundReason,
  AdminSponsorshipRefundRequest,
  AdminSponsorshipRefundResult,
  ContributionType,
  CheckoutResult,
  CheckoutRequest,
  PublicReferenceLookupRequest,
  PublicReferenceLookupResponse,
  ReferenceRecoveryRequest,
  ReferenceRecoveryResult,
  RedirectCheckoutResult,
  SponsorFeedChannel,
  SponsorFeedTarget,
  SponsorshipDetailsRequest,
  SponsorshipDetailsResult
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
import { updateAdminSponsorshipDetails } from './admin-sponsorship-details.service.js';
import {
  getSponsorshipInterventions,
  recordSponsorshipIntervention
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
import { createAdminSponsorshipRecordsHttpHandler } from './admin-sponsorship-records.http.js';
import { createAdminSponsorshipDecisionsHttpHandler } from './admin-sponsorship-decisions.http.js';
import { createAdminSponsorshipMediaHttpHandler } from './admin-sponsorship-media.http.js';
import { createAdminPilotageHttpHandler } from './admin-pilotage.http.js';
import { createAdminPublicationAutomationHttpHandler } from './admin-publication-automation.http.js';
import { createPublicFundingHttpHandler } from './public-funding.http.js';
import { createPublicSponsorMediaHttpHandler } from './public-sponsor-media.http.js';
import { createSponsorshipFollowupHttpHandler } from './sponsorship-followup.http.js';
import { createSponsorshipFollowupMediaHttpHandler } from './sponsorship-followup-media.http.js';
import { createAdminAssistantHttpHandler } from './admin-assistant.http.js';
import { createAdminContributionsHttpHandler } from './admin-contributions.http.js';
import { createAdminDocumentsHttpHandler } from './admin-documents.http.js';
import { createAdminAccountingHttpHandler } from './admin-accounting.http.js';
import { createAdminPublicationDraftsHttpHandler } from './admin-publication-drafts.http.js';
import { createAdminPublicationSlotsHttpHandler } from './admin-publication-slots.http.js';
import { createAdminPublicationBatchesHttpHandler } from './admin-publication-batches.http.js';
import { createAdminEmailHttpHandler } from './admin-email.http.js';
import { createAdminInsightsHttpHandler } from './admin-insights.http.js';
import { loadSponsorMediaLimits } from './sponsor-media-limits.js';
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
import { requestSponsorshipInformation } from './sponsorship-information.service.js';
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
import { createRouteMatcher } from './http-routing.js';
import { createRequestRateLimit } from './http-rate-limit.js';
import { SPONSOR_LOGO_FILENAME_PATTERN } from './sponsor-logo-upload.js';

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

const isAllowedSponsorshipStripeRefundReason = (
  value: unknown
): value is AdminSponsorshipStripeRefundReason =>
  typeof value === 'string' &&
  allowedSponsorshipStripeRefundReasons.has(
    value as AdminSponsorshipStripeRefundReason
  );

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

const isAllowedSponsorFeedTarget = (
  value: unknown
): value is SponsorFeedTarget | null =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'string' &&
    allowedSponsorFeedTargets.has(value as SponsorFeedTarget));

const isAllowedSponsorFeedChannel = (
  value: unknown
): value is SponsorFeedChannel =>
  typeof value === 'string' &&
  allowedSponsorFeedChannels.has(value as SponsorFeedChannel);

const isValidAdminExpectedVersion = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= 128;

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

const socialPublicationRuntime = (): {
  readonly mode: typeof socialPublicationConfig.mode;
  readonly configuredChannels: readonly SponsorFeedChannel[];
} => ({
  mode: socialPublicationConfig.mode,
  configuredChannels: configuredSocialPublicationChannels(
    socialPublicationConfig
  )
});

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

const handleAdminSponsorshipRecordsRequest =
  createAdminSponsorshipRecordsHttpHandler({
    publicBaseOrigin,
    ensureAdminAuthorization,
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    isValidUuid,
    allowedSponsorshipReviewStatuses,
    allowedSponsorFeedStatuses,
    listAdminSponsorships: (query) => listAdminSponsorships(dbPool, query),
    getSponsorshipProgress: (id) => getSponsorshipProgress(dbPool, id),
    requestSponsorshipInformation: (input, actor) =>
      requestSponsorshipInformation(dbPool!, input, actor),
    updateAdminSponsorshipDetails: (input, actor) =>
      updateAdminSponsorshipDetails(dbPool!, input, actor),
    getSponsorshipInterventions: (id, before) =>
      getSponsorshipInterventions(dbPool!, id, before),
    recordSponsorshipIntervention: (input, actor) =>
      recordSponsorshipIntervention(dbPool!, input, actor),
    reportFailure: (message, error) => console.error(message, error)
  });

const handleAdminSponsorshipDecisionsRequest =
  createAdminSponsorshipDecisionsHttpHandler({
    publicBaseOrigin,
    databaseAvailable: () => Boolean(dbPool),
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    writeSponsorshipMutationFailure,
    adminReviewNoteMaxLength: ADMIN_REVIEW_NOTE_MAX_LENGTH,
    sponsorMessageMaxLength: SPONSOR_MESSAGE_MAX_LENGTH,
    isValidOptionalBoundedText,
    isValidSponsorEmail,
    isValidAdminExpectedVersion,
    isValidOptionalHttpsUrl,
    isAllowedSponsorFeedTarget,
    allowedSponsorshipReviewStatuses,
    allowedSponsorFeedStatuses,
    allowedSponsorFeedChannels,
    isSponsorshipWebsiteVisibilityRequest,
    updateSponsorshipReview: (input) => updateSponsorshipReview(dbPool, input),
    updateSponsorshipRefundWorkflowStatus: (input) =>
      updateSponsorshipRefundWorkflowStatus(dbPool, input),
    getAdminSponsorshipById: (id) => getAdminSponsorshipById(dbPool, id),
    queueSponsorshipRejectionEmail: (input) =>
      queueSponsorshipRejectionEmail(dbPool, input),
    setSponsorshipWebsiteVisibility: (input, actor) =>
      setSponsorshipWebsiteVisibility(dbPool!, input, actor),
    updateSponsorshipPublication: (input) =>
      updateSponsorshipPublication(dbPool, input),
    insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input),
    reportFailure: (message, error) => console.error(message, error)
  });

const handleAdminSponsorshipMediaRequest =
  createAdminSponsorshipMediaHttpHandler({
    publicBaseOrigin,
    sponsorMediaMaxBytes,
    sponsorMediaMaxSupportingImages,
    sponsorLogoMaxBytes,
    SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH,
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    readBodyBuffer,
    writeJson,
    writeBinary,
    isValidUuid,
    isValidAdminExpectedVersion,
    routeAssetId,
    listSponsorMediaAssets: (id) => listSponsorMediaAssets(dbPool, id),
    getSponsorMediaStorageRecord: (id) =>
      getSponsorMediaStorageRecord(dbPool, id),
    reviewSponsorMediaAsset: (input) => reviewSponsorMediaAsset(dbPool, input),
    deleteSponsorMediaAsset: (input) => deleteSponsorMediaAsset(dbPool, input),
    sponsorMediaStorage,
    sponsorMediaPublicKey,
    sponsorMediaPublicUrl,
    deleteSponsorMediaObjects,
    writeSponsorMediaMutationFailure,
    getAdminSponsorshipLogoUrl: (id) => getAdminSponsorshipLogoUrl(dbPool, id),
    clearSponsorshipLogoUrl: (input) => clearSponsorshipLogoUrl(dbPool, input),
    updateSponsorshipLogoUrl: (input) =>
      updateSponsorshipLogoUrl(dbPool, input),
    sponsorLogoStorage,
    getSponsorLogoFilenameFromUrl,
    sponsorLogoPublicUrlForFilename,
    deleteControlledSponsorLogoFile,
    writeSponsorshipMutationFailure,
    insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input),
    reportFailure: (message, error) => console.error(message, error)
  });

const handleSponsorshipFollowupRequest = createSponsorshipFollowupHttpHandler({
  publicBaseOrigin,
  databaseAvailable: () => Boolean(dbPool),
  hasDatabase,
  sponsorshipFollowupTokenTtlDays,
  SPONSOR_TEXT_MAX_LENGTH,
  SPONSOR_MESSAGE_MAX_LENGTH,
  followupEditablePaymentStatuses,
  readBody,
  writeJson,
  isValidFollowupToken,
  hasOnlyKeys,
  isNonEmptySponsorText,
  isValidSponsorEmail,
  isValidOptionalHttpsUrl,
  truncateStripeMetadataValue,
  normalizeRecoveryEmail,
  SponsorshipAccessError,
  getFreshSponsorshipFollowupByToken,
  recoverSponsorshipAccess: (email, options) =>
    recoverSponsorshipAccess(dbPool!, email, options),
  getSponsorshipDraft: (token, ttlDays) =>
    getSponsorshipDraft(dbPool!, token, ttlDays),
  saveSponsorshipDraft: (token, ttlDays, revision, input) =>
    saveSponsorshipDraft(dbPool!, token, ttlDays, revision, input),
  submitSponsorshipDraft: (token, ttlDays, revision, input) =>
    submitSponsorshipDraft(dbPool!, token, ttlDays, revision, input),
  updateStripePaymentIntentMetadata: stripe
    ? (id, input) => stripe.paymentIntents.update(id, input)
    : undefined,
  reportFailure: (message, error) =>
    error === undefined ? console.error(message) : console.error(message, error)
});

const handleSponsorshipFollowupMediaRequest =
  createSponsorshipFollowupMediaHttpHandler({
    publicBaseOrigin,
    databaseAvailable: () => hasDatabase,
    sponsorMediaMaxBytes,
    sponsorMediaMaxSupportingImages,
    SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH,
    followupEditablePaymentStatuses,
    readBody,
    readBodyBuffer,
    writeJson,
    writeBinary,
    isValidFollowupToken,
    isValidUuid,
    isValidAdminExpectedVersion,
    hasOnlyKeys,
    routeAssetId,
    getFreshSponsorshipFollowupByToken,
    listSponsorMediaAssets: (id) => listSponsorMediaAssets(dbPool, id),
    getSponsorMediaStorageRecord: (id) =>
      getSponsorMediaStorageRecord(dbPool, id),
    checkSponsorMediaUpload: (id, kind, maxSupportingImages) =>
      checkSponsorMediaUpload(dbPool, id, kind, maxSupportingImages),
    createSponsorMediaAsset: (input) => createSponsorMediaAsset(dbPool, input),
    deleteSponsorMediaAsset: (input) => deleteSponsorMediaAsset(dbPool, input),
    processSponsorImage,
    sponsorMediaStorage,
    deleteSponsorMediaObjects,
    writeSponsorMediaMutationFailure,
    insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input),
    reportFailure: (message, error) => console.error(message, error)
  });

const handlePublicSponsorMediaRequest = createPublicSponsorMediaHttpHandler({
  databaseAvailable: () => hasDatabase,
  writeJson,
  writeBinary,
  routeAssetId,
  getApprovedPublicSponsorMedia: (id) =>
    getApprovedPublicSponsorMedia(dbPool, id),
  sponsorMediaStorage,
  getSponsorLogoFilenameFromUrl,
  sponsorLogoPublicUrlForFilename,
  isPublicApprovedSponsorshipLogoUrl: (url) =>
    isPublicApprovedSponsorshipLogoUrl(dbPool, url),
  sponsorLogoStorage,
  reportFailure: (message, error) => console.error(message, error)
});

const handleAdminAssistantRequest = createAdminAssistantHttpHandler({
  publicBaseOrigin,
  ensureAdminAuthorization,
  ensureAdminAccess,
  readBody,
  writeJson,
  isValidUuid,
  adminAssistantConfig,
  getAdminAssistantContext: (sponsorshipId) =>
    getAdminAssistantContext(
      dbPool,
      sponsorshipId,
      adminAssistantConfig.enabled && adminAssistantConfig.providerConfigured
        ? adminAssistantConfig.provider
        : 'disabled'
    ),
  buildAdminAssistantSummary: () => buildAdminAssistantSummary(dbPool),
  runAdminAssistantQuery: (input) =>
    runAdminAssistantQuery({
      ...input,
      pool: dbPool,
      config: adminAssistantConfig
    }),
  prepareAdminAssistantDraft: (input) =>
    prepareAdminAssistantDraft(dbPool, input),
  recordAdminAssistantAudit,
  reportFailure: (message, error) => console.error(message, error)
});

const handleAdminPublicationDraftsRequest =
  createAdminPublicationDraftsHttpHandler({
    publicBaseOrigin,
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    isValidUuid,
    isAllowedSponsorFeedChannel,
    isValidOptionalBoundedText,
    reportFailure: (message, error) => console.error(message, error),
    allowedPublicationDraftStatuses,
    isValidOptionalNonEmptyBoundedText,
    isValidOptionalHttpsUrl,
    isValidOptionalIsoDate,
    listAdminPublicationDrafts: (input) =>
      listAdminPublicationDrafts(dbPool, input),
    createAdminPublicationDraft: (input) =>
      createAdminPublicationDraft(dbPool, input),
    updateAdminPublicationDraft: (input) =>
      updateAdminPublicationDraft(dbPool, input),
    insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input)
  });

const handleAdminPublicationSlotsRequest =
  createAdminPublicationSlotsHttpHandler({
    publicBaseOrigin,
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    isValidUuid,
    isAllowedSponsorFeedChannel,
    isValidOptionalBoundedText,
    reportFailure: (message, error) => console.error(message, error),
    isAllowedSponsorFeedTarget,
    listAdminPublicationSlots: (input) =>
      listAdminPublicationSlots(dbPool, input),
    createAdminPublicationSlot: (input) =>
      createAdminPublicationSlot(dbPool, input),
    updateAdminPublicationSlot: (input) =>
      updateAdminPublicationSlot(dbPool, input),
    assignBatchToPublicationSlot: (input) =>
      assignBatchToPublicationSlot(dbPool, input),
    assignDraftToPublicationSlot: (input) =>
      assignDraftToPublicationSlot(dbPool, input),
    publishAdminPublicationSlot: (input) =>
      publishAdminPublicationSlot(dbPool, input),
    cancelAdminPublicationSlot: (input) =>
      cancelAdminPublicationSlot(dbPool, input),
    insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input)
  });

const handleAdminPublicationBatchesRequest =
  createAdminPublicationBatchesHttpHandler({
    publicBaseOrigin,
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    isValidUuid,
    isAllowedSponsorFeedChannel,
    isValidOptionalBoundedText,
    reportFailure: (message, error) => console.error(message, error),
    socialPublicationRuntime,
    reportWarning: (message, error) => console.warn(message, error),
    listAdminPublicationBatches: (input) =>
      listAdminPublicationBatches(dbPool, input),
    createAdminPublicationBatch: (input) =>
      createAdminPublicationBatch(dbPool, input),
    assignDraftToPublicationBatch: (input) =>
      assignDraftToPublicationBatch(dbPool, input),
    unassignDraftFromPublicationBatch: (input) =>
      unassignDraftFromPublicationBatch(dbPool, input),
    scheduleAdminPublicationBatch: (input) =>
      scheduleAdminPublicationBatch(dbPool, input),
    publishAdminPublicationBatch: (input) =>
      publishAdminPublicationBatch(dbPool, input),
    cancelAdminPublicationBatch: (input) =>
      cancelAdminPublicationBatch(dbPool, input),
    listAdminSocialPublicationJobs: (input) =>
      listAdminSocialPublicationJobs(dbPool, input),
    getPublicationBatchById: (input) => getPublicationBatchById(dbPool, input),
    insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input),
    queuePublicationBatchFullNotification: (input) =>
      queuePublicationBatchFullNotification(dbPool, input)
  });

const handleAdminPilotageRequest = createAdminPilotageHttpHandler({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  adminPilotage,
  adminIdentity,
  PilotError,
  PublicationAutomationError
});

const handleAdminPublicationAutomationRequest =
  createAdminPublicationAutomationHttpHandler({
    publicBaseOrigin,
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    publicationAutomation,
    PublicationAutomationError
  });

const handlePublicFundingRequest = createPublicFundingHttpHandler({
  publicBaseOrigin,
  writeJson,
  listPublicSponsorships: (pagination) =>
    listPublicSponsorships(dbPool, pagination),
  listPublicBuilders: (pagination) => listPublicBuilders(dbPool, pagination),
  getPublicSponsorshipBatchAvailability: () =>
    getPublicSponsorshipBatchAvailability(dbPool),
  getPublicFundingRuntimeConfig: () => ({
    business_sponsorship_enabled: businessSponsorshipEnabled,
    allowed_contribution_amounts: [...allowedContributionAmounts],
    last_updated_at: new Date().toISOString()
  }),
  getPublicTransparencySummary: () =>
    hasDatabase
      ? getPublicTransparencySummary(dbPool)
      : readStripeTransparency
        ? readStripeTransparency()
        : getPublicTransparencySummary(null),
  reportFailure: (message, error) =>
    error === undefined ? console.error(message) : console.error(message, error)
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

  if (await handleAdminPilotageRequest(request, response)) return;

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

  if (await handleAdminPublicationAutomationRequest(request, response)) return;

  if (await handleAdminSponsorshipMediaRequest(request, response)) return;

  if (await handleSponsorshipFollowupMediaRequest(request, response)) return;

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

  if (await handleSponsorshipFollowupRequest(request, response)) return;

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

  if (await handlePublicSponsorMediaRequest(request, response)) return;

  if (await handleAdminInsightsRequest(request, response)) return;

  if (await handleAdminSponsorshipRecordsRequest(request, response)) return;

  if (await handleAdminAssistantRequest(request, response)) return;

  if (await handleAdminContributionsRequest(request, response)) return;

  if (await handleAdminAccountingRequest(request, response)) return;

  if (await handleAdminPublicationDraftsRequest(request, response)) return;

  if (await handleAdminPublicationSlotsRequest(request, response)) return;

  if (await handleAdminPublicationBatchesRequest(request, response)) return;

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

  if (await handleAdminSponsorshipDecisionsRequest(request, response)) return;

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

  if (await handlePublicFundingRequest(request, response)) return;

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
