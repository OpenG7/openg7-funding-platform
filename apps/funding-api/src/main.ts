import { createHash, randomBytes } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import path from 'node:path';

import type {
  AdminSetupStatusResponse,
  AdminSponsorshipStripeRefundReason,
  CheckoutRequest,
  CheckoutResult,
  ContributionType,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';
import Stripe from 'stripe';

import {
  isSponsorshipEmail,
  isSponsorshipHttpsUrl
} from '../../../packages/funding-core/src/index.js';

import { createAdminAccountingHttpHandler } from './admin-accounting.http.js';
import { createAdminAuditHttpHandler } from './admin-audit.http.js';
import { createAdminBackupsHttpHandler } from './admin-backups.http.js';
import { createAdminContributionActivityHttpHandler } from './admin-contribution-activity.http.js';
import { createAdminSessionHttpHandler } from './admin-session.http.js';
import { createAdminSetupHttpHandler } from './admin-setup.http.js';
import { createAdminSponsorshipAccessHttpHandler } from './admin-sponsorship-access.http.js';
import { createAdminSponsorshipRefundHttpHandler } from './admin-sponsorship-refund.http.js';
import { createAdminStripeBackfillHttpHandler } from './admin-stripe-backfill.http.js';
import { createLegacySponsorshipDetailsHttpHandler } from './legacy-sponsorship-details.http.js';
import { createPublicPaymentsHttpHandler } from './public-payments.http.js';
import { createPublicReferencesHttpHandlers } from './public-references.http.js';
import { createStripeWebhookHttpHandler } from './stripe-webhook.http.js';
import { createAdminAssistantHttpHandler } from './admin-assistant.http.js';
import { buildAdminAssistantSummary } from './admin-assistant/attention.service.js';
import { loadAdminAssistantConfig } from './admin-assistant/config.js';
import { getAdminAssistantContext } from './admin-assistant/context.service.js';
import { runAdminAssistantQuery } from './admin-assistant/orchestrator.js';
import { prepareAdminAssistantDraft } from './admin-assistant/preparation.service.js';
import { getCockpitActivity } from './admin-cockpit/activity.js';
import { getCockpitMetrics } from './admin-cockpit/metrics.js';
import { readSnapshot } from './admin-cockpit/read.js';
import { readStripeConnection } from './admin-cockpit/stripe-connection.js';
import {
  createCockpitSystemsReader,
  readSystemObservation
} from './admin-cockpit/systems.js';
import {
  ContributionExportError,
  exportAdminContributions
} from './admin-contributions-export.service.js';
import { createAdminContributionsHttpHandler } from './admin-contributions.http.js';
import {
  DocumentResendConflict,
  queueAdminDocumentResend
} from './admin-document-resend.service.js';
import { createAdminDocumentsHttpHandler } from './admin-documents.http.js';
import { createAdminEmailHttpHandler } from './admin-email.http.js';
import { AdminIdentityService } from './admin-identity.js';
import { createAdminInsightsHttpHandler } from './admin-insights.http.js';
import { createAdminPilotageHttpHandler } from './admin-pilotage.http.js';
import { AdminPilotageService, PilotError } from './admin-pilotage.service.js';
import { createAdminPublicationAutomationHttpHandler } from './admin-publication-automation.http.js';
import { createAdminPublicationBatchesHttpHandler } from './admin-publication-batches.http.js';
import { createAdminPublicationDraftsHttpHandler } from './admin-publication-drafts.http.js';
import { createAdminPublicationSlotsHttpHandler } from './admin-publication-slots.http.js';
import {
  buildSponsorshipReviewReminderAdminUrl,
  loadAdminSponsorshipReviewReminderConfig,
  queueDueSponsorshipReviewReminder
} from './admin-reminder.service.js';
import { parseAdminSearch, searchAdmin } from './admin-search.service.js';
import { createAdminSponsorshipDecisionsHttpHandler } from './admin-sponsorship-decisions.http.js';
import { updateAdminSponsorshipDetails } from './admin-sponsorship-details.service.js';
import { createAdminSponsorshipMediaHttpHandler } from './admin-sponsorship-media.http.js';
import { createAdminSponsorshipRecordsHttpHandler } from './admin-sponsorship-records.http.js';
import {
  AdminStripeBackfillError,
  AdminStripeBackfillService
} from './admin-stripe-backfill.service.js';
import {
  getAdminStripeEvent,
  validStripeEventId
} from './admin-stripe-event.service.js';
import { createAdminTokenSessionService } from './admin-token-session.js';
import {
  getAdminWorkQueue,
  parseWorkQueueQuery
} from './admin-work-queue.service.js';
import {
  ContributionActivityService,
  contributionNotificationConfig
} from './contribution-activity.service.js';
import { normalizeContributionPublicReference } from './contribution-public-reference.js';
import {
  BackupError,
  backupStatus,
  isBackupId,
  requestBackup
} from './database-backup/service.js';
import { dbPool, hasDatabase } from './database.js';
import {
  EmailConfigurationTestError,
  getAdminEmailQueueMessageById,
  getEmailConfigurationTest,
  getEmailQueueStatus,
  isEmailTestRequestId,
  listAdminEmailQueue,
  processQueuedEmailMessages,
  queueContributionReferenceRecoveryEmail,
  queueEmailConfigurationTest,
  queuePublicationBatchFullNotification,
  queueSponsorshipCreditNoteEmail,
  queueSponsorshipRefundEmail,
  queueSponsorshipRejectionEmail,
  retryAdminEmailQueueMessage
} from './email-notification.service.js';
import {
  parseBooleanEnv,
  parseNonNegativeIntegerEnv,
  parsePositiveIntegerEnv
} from './environment-values.js';
import {
  AdminExpenseValidationError,
  allowedAdminExpenseStatuses,
  allowedPublicationDraftStatuses,
  assignBatchToPublicationSlot,
  assignDraftToPublicationBatch,
  assignDraftToPublicationSlot,
  cancelAdminPublicationBatch,
  cancelAdminPublicationSlot,
  createAdminExpense,
  createAdminPublicationBatch,
  createAdminPublicationDraft,
  createAdminPublicationSlot,
  getPublicationBatchById,
  getPublicSponsorshipBatchAvailability,
  insertAdminAuditLog,
  listAdminAuditLog,
  listAdminExpenses,
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
import {
  allowedSponsorFeedChannels,
  allowedSponsorFeedStatuses,
  allowedSponsorFeedTargets,
  allowedSponsorshipReviewStatuses,
  clearSponsorshipLogoUrl,
  getAdminDashboard,
  getAdminSponsorshipById,
  getAdminSponsorshipLogoUrl,
  getSponsorshipFollowupByTokenHash,
  getSponsorshipRefundTarget,
  insertCheckoutSessionRecord,
  isPublicApprovedSponsorshipLogoUrl,
  listAdminContributions,
  listAdminSponsorships,
  listContributionReferencesByEmail,
  listPublicSponsorships,
  lookupPublicContributionReference,
  normalizeContributionType,
  parseMetadataBoolean,
  recordSponsorshipDetails,
  updateContributionStatusByPaymentIntent,
  updateSponsorshipLogoUrl,
  updateSponsorshipPublication,
  updateSponsorshipRefundWorkflowStatus,
  updateSponsorshipReview,
  upsertCheckoutSessionFromWebhook,
  type SponsorshipFollowupLookup
} from './fund-contributions.repository.js';
import {
  getPublicTransparencySummary,
  listPublicBuilders
} from './fund-transparency.repository.js';
import { createRequestRateLimit } from './http-rate-limit.js';
import { createRouteMatcher } from './http-routing.js';
import {
  createHttpTransport,
  readBody,
  readBodyBuffer
} from './http-transport.js';
import { createPublicFundingHttpHandler } from './public-funding.http.js';
import { createPublicSponsorMediaHttpHandler } from './public-sponsor-media.http.js';
import { createPublicTransparencyCache } from './public-transparency-cache.js';
import { PublicationAutomationError } from './publication-automation/policy.js';
import { PublicationAutomationService } from './publication-automation/service.js';
import { loadTrustedProxyHops } from './request-client-ip.js';
import {
  getTransactionalEmailConfigStatus,
  isValidEmailAddress,
  loadEmailQueueWorkerEnabled,
  loadTransactionalEmailConfig
} from './services/email/index.js';
import {
  configuredSocialPublicationChannels,
  loadSocialPublicationConfig
} from './social-publication.service.js';
import { processSponsorImage } from './sponsor-image.service.js';
import { SPONSOR_LOGO_FILENAME_PATTERN } from './sponsor-logo-upload.js';
import { loadSponsorMediaLimits } from './sponsor-media-limits.js';
import {
  createSponsorLogoStorage,
  createSponsorMediaStorage,
  type SponsorLogoStorageConfig
} from './sponsor-media-storage.js';
import {
  checkSponsorMediaUpload,
  createSponsorMediaAsset,
  deleteSponsorMediaAsset,
  getApprovedPublicSponsorMedia,
  getSponsorMediaStorageRecord,
  listSponsorMediaAssets,
  reviewSponsorMediaAsset,
  type SponsorMediaStorageRecord
} from './sponsor-media.repository.js';
import {
  getSponsorshipAccessRecipient,
  getSponsorshipDraft,
  issueSponsorshipAccess,
  normalizeRecoveryEmail,
  recoverSponsorshipAccess,
  saveSponsorshipDraft,
  SponsorshipAccessError,
  submitSponsorshipDraft
} from './sponsorship-access.service.js';
import {
  renderSponsorshipCreditNotePdf,
  renderSponsorshipInvoicePdf,
  sponsorshipCreditNotePdfFilename,
  sponsorshipInvoicePdfFilename
} from './sponsorship-document-pdf.service.js';
import { createSponsorshipFollowupMediaHttpHandler } from './sponsorship-followup-media.http.js';
import { createSponsorshipFollowupHttpHandler } from './sponsorship-followup.http.js';
import { requestSponsorshipInformation } from './sponsorship-information.service.js';
import {
  getSponsorshipInterventions,
  recordSponsorshipIntervention
} from './sponsorship-interventions.service.js';
import { sponsorshipInvoiceConfig } from './sponsorship-invoice-config.js';
import {
  backfillMissingSponsorshipInvoices,
  createSponsorshipCreditNoteForRefund,
  getAdminSponsorshipCreditNoteById,
  getAdminSponsorshipInvoiceById,
  getSponsorshipCreditNoteById,
  getSponsorshipInvoiceById,
  listAdminSponsorshipInvoices
} from './sponsorship-invoices.repository.js';
import { getSponsorshipProgress } from './sponsorship-progress.service.js';
import {
  beginSponsorshipRefundOperation,
  failSponsorshipRefundOperation,
  settleSponsorshipRefundOperation
} from './sponsorship-refund-operations.js';
import {
  isSponsorshipWebsiteVisibilityRequest,
  setSponsorshipWebsiteVisibility
} from './sponsorship-website.service.js';
import { simulatedCheckoutEnabled } from './stripe-checkout-config.js';
import { getStripePublicTransparencySummary } from './stripe-transparency.service.js';
import { processStripeWebhook } from './stripe-webhook.service.js';

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

const handlePublicPaymentsRequest = createPublicPaymentsHttpHandler({
  publicBaseOrigin,
  readBody,
  writeJson,
  projectId,
  isProduction,
  businessSponsorshipEnabled,
  allowedContributionAmounts,
  PUBLIC_DISPLAY_NAME_MAX_LENGTH,
  stripeApiHost,
  navigableSimulatedCheckout,
  stripe,
  normalizeAmount,
  isAllowedContributionType,
  isBoolean,
  isNonEmptySponsorText,
  isValidOptionalBoundedText,
  createDevelopmentCheckoutResult,
  resolveCheckoutReturnUrl,
  createSponsorshipFollowupToken,
  hashSponsorshipFollowupToken,
  createContributionPublicReference,
  buildContributionCheckoutSuccessUrl,
  buildContributionReceiptDescription,
  truncateStripeMetadataValue,
  resolveStripePaymentIntentId,
  insertCheckoutSessionRecord: (input) =>
    insertCheckoutSessionRecord(dbPool, input),
  reportFailure: (message, error) => console.error(message, error)
});

const { handleReferenceLookupRequest, handleReferenceRecoveryRequest } =
  createPublicReferencesHttpHandlers({
    publicBaseOrigin,
    readBody,
    writeJson,
    hasDatabase,
    normalizeReferenceRecoveryEmail,
    createReferenceRecoveryIdempotencyKey,
    lookupPublicContributionReference: (reference) =>
      lookupPublicContributionReference(dbPool, reference),
    listContributionReferencesByEmail: (email) =>
      listContributionReferencesByEmail(dbPool, email),
    queueContributionReferenceRecoveryEmail: (input) =>
      queueContributionReferenceRecoveryEmail(dbPool, input),
    reportFailure: (...args) => console.error(...args),
    reportWarning: (message) => console.warn(message)
  });

const handleLegacySponsorshipDetailsRequest =
  createLegacySponsorshipDetailsHttpHandler({
    publicBaseOrigin,
    readBody,
    writeJson,
    SPONSOR_TEXT_MAX_LENGTH,
    SPONSOR_MESSAGE_MAX_LENGTH,
    stripe,
    isNonEmptySponsorText,
    isValidSponsorEmail,
    isValidOptionalHttpsUrl,
    truncateStripeMetadataValue,
    resolveStripePaymentIntentId,
    recordSponsorshipDetails: (input) =>
      recordSponsorshipDetails(dbPool, input),
    reportFailure: (message, error) => console.error(message, error)
  });

const handleStripeWebhookRequest = createStripeWebhookHttpHandler({
  publicBaseOrigin,
  readBody,
  writeJson,
  isConfigured: Boolean(stripe && stripeWebhookSecret),
  processStripeWebhook: (rawBody, stripeSignature) =>
    processStripeWebhook(rawBody, stripeSignature, {
      stripe: stripe!,
      webhookSecret: stripeWebhookSecret!,
      pool: dbPool,
      publicBaseUrl: publicBaseUrl ?? publicBaseOrigin,
      projectId
    })
});

const handleAdminSponsorshipRefundRequest =
  createAdminSponsorshipRefundHttpHandler({
    publicBaseOrigin,
    isProduction,
    stripe,
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    isValidUuid,
    isValidAdminExpectedVersion,
    isAllowedSponsorshipStripeRefundReason,
    isValidOptionalBoundedText,
    isValidSponsorEmail,
    adminReviewNoteMaxLength: ADMIN_REVIEW_NOTE_MAX_LENGTH,
    sponsorMessageMaxLength: SPONSOR_MESSAGE_MAX_LENGTH,
    amountToCents,
    sponsorshipRefundConfirmationText,
    writeSponsorshipRefundIneligible,
    createDevelopmentRefundResult,
    getSponsorshipRefundTarget: (id) => getSponsorshipRefundTarget(dbPool, id),
    beginSponsorshipRefundOperation: (input) =>
      beginSponsorshipRefundOperation(dbPool!, input),
    settleSponsorshipRefundOperation: (refund, id) =>
      settleSponsorshipRefundOperation(dbPool, refund, id),
    failSponsorshipRefundOperation: (id, definitive) =>
      failSponsorshipRefundOperation(dbPool!, id, definitive),
    updateContributionStatusByPaymentIntent: (input) =>
      updateContributionStatusByPaymentIntent(dbPool, input),
    createSponsorshipCreditNoteForRefund: (input) =>
      createSponsorshipCreditNoteForRefund(dbPool, input),
    getAdminSponsorshipCreditNoteById: (id) =>
      getAdminSponsorshipCreditNoteById(dbPool, id),
    queueSponsorshipCreditNoteEmail: (input) =>
      queueSponsorshipCreditNoteEmail(dbPool, input),
    queueSponsorshipRefundEmail: (input) =>
      queueSponsorshipRefundEmail(dbPool, input),
    insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input),
    getAdminSponsorshipById: (id) => getAdminSponsorshipById(dbPool, id),
    reportFailure: (...args) => console.error(...args)
  });

const handleAdminStripeBackfillRequest = createAdminStripeBackfillHttpHandler({
  publicBaseOrigin,
  allowedOrigins,
  ensureAdminAccess,
  resolveAdminAuthorization,
  getAdminAuditActor,
  readBody,
  writeJson,
  adminStripeBackfill,
  AdminStripeBackfillError
});
const handleAdminContributionActivityRequest =
  createAdminContributionActivityHttpHandler({
    publicBaseOrigin,
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    contributionActivity
  });
const handleAdminSessionRequest = createAdminSessionHttpHandler({
  publicBaseOrigin,
  adminTokenConfigured: Boolean(adminToken),
  isProduction,
  adminTokenMatches,
  createAdminSession,
  readBody,
  writeJson
});
const handleAdminBackupsRequest = createAdminBackupsHttpHandler({
  publicBaseOrigin,
  allowedOrigins,
  databaseAvailable: () => Boolean(dbPool),
  ensureAdminAccess,
  resolveAdminAuthorization,
  getAdminAuditActor,
  readBody,
  writeJson,
  isBackupId,
  BackupError,
  backupStatus: (id) => backupStatus(dbPool!, id),
  requestBackup: (id, actor) => requestBackup(dbPool!, id, actor)
});
const handleAdminSetupRequest = createAdminSetupHttpHandler({
  publicBaseOrigin,
  ensureAdminAuthorization,
  writeJson,
  buildAdminSetupStatus,
  reportFailure: (message, error) => console.error(message, error)
});
const handleAdminAuditRequest = createAdminAuditHttpHandler({
  publicBaseOrigin,
  ensureAdminAccess,
  writeJson,
  isValidUuid,
  listAdminAuditLog: (id) => listAdminAuditLog(dbPool, id),
  reportFailure: (message, error) => console.error(message, error)
});
const handleAdminSponsorshipAccessRequest =
  createAdminSponsorshipAccessHttpHandler({
    publicBaseOrigin,
    ttlDays: sponsorshipFollowupTokenTtlDays,
    databaseAvailable: () => Boolean(dbPool),
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    isValidUuid,
    normalizeRecoveryEmail,
    SponsorshipAccessError,
    getSponsorshipAccessRecipient: (id) =>
      getSponsorshipAccessRecipient(dbPool!, id),
    issueSponsorshipAccess: (id, recipient, options, audit) =>
      issueSponsorshipAccess(dbPool!, id, recipient, options, audit)
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

  if (await handleAdminStripeBackfillRequest(request, response)) return;

  if (await handleAdminPilotageRequest(request, response)) return;

  if (await handleAdminContributionActivityRequest(request, response)) return;

  if (await handleAdminPublicationAutomationRequest(request, response)) return;

  if (await handleAdminSponsorshipMediaRequest(request, response)) return;

  if (await handleSponsorshipFollowupMediaRequest(request, response)) return;

  if (await handleReferenceLookupRequest(request, response)) return;

  if (await handlePublicPaymentsRequest(request, response)) return;

  if (await handleReferenceRecoveryRequest(request, response)) return;

  if (await handleSponsorshipFollowupRequest(request, response)) return;

  if (await handleAdminSponsorshipAccessRequest(request, response)) return;

  if (await handleLegacySponsorshipDetailsRequest(request, response)) return;

  if (await handleStripeWebhookRequest(request, response)) return;

  if (await handleAdminSessionRequest(request, response)) return;

  if (await handleAdminBackupsRequest(request, response)) return;

  if (await handleAdminSetupRequest(request, response)) return;

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

  if (await handleAdminAuditRequest(request, response)) return;

  if (await handleAdminSponsorshipDecisionsRequest(request, response)) return;

  if (await handleAdminSponsorshipRefundRequest(request, response)) return;

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
