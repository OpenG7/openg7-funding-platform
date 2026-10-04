import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';

import type { SponsorFeedChannel } from '@openg7/funding-core';
import Stripe from 'stripe';

import { createAdminAccountingHttpHandler } from './admin-accounting.http.js';
import { createAdminAuditHttpHandler } from './admin-audit.http.js';
import { createAdminAuthorization } from './admin-authorization.js';
import { createApiBackgroundWorkers } from './api-background-workers.js';
import {
  createCheckoutReturnUrlResolver,
  loadApiRuntimeAdminAuthMode,
  loadApiRuntimeConfig,
  loadApiRuntimeContributionNotificationConfig,
  loadApiRuntimeEmailConfig,
  loadApiRuntimeHttpConfig,
  loadApiRuntimeSocialPublicationConfig,
  validateApiRuntimeConfig
} from './api-runtime-config.js';
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
import { ContributionActivityService } from './contribution-activity.service.js';
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
  recordSponsorshipDetails,
  updateContributionStatusByPaymentIntent,
  updateSponsorshipLogoUrl,
  updateSponsorshipPublication,
  updateSponsorshipRefundWorkflowStatus,
  updateSponsorshipReview,
  upsertCheckoutSessionFromWebhook
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
import { getTransactionalEmailConfigStatus } from './services/email/index.js';
import { configuredSocialPublicationChannels } from './social-publication.service.js';
import { processSponsorImage } from './sponsor-image.service.js';
import {
  createSponsorLogoStorage,
  createSponsorMediaStorage
} from './sponsor-media-storage.js';
import {
  checkSponsorMediaUpload,
  createSponsorMediaAsset,
  deleteSponsorMediaAsset,
  getApprovedPublicSponsorMedia,
  getSponsorMediaStorageRecord,
  listSponsorMediaAssets,
  reviewSponsorMediaAsset
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
import { getStripePublicTransparencySummary } from './stripe-transparency.service.js';
import { processStripeWebhook } from './stripe-webhook.service.js';
import { createAdminSetupHelpers } from './business-helpers/admin-setup.js';
import { createAssistantAuditRecorder } from './business-helpers/assistant-audit.js';
import {
  buildContributionReceiptDescription,
  createContributionPublicReference,
  createContributionReferenceHelpers,
  createReferenceRecoveryIdempotencyKey,
  normalizeReferenceRecoveryEmail
} from './business-helpers/contribution-reference.js';
import {
  createDevelopmentCheckoutResult,
  createDevelopmentRefundResult
} from './business-helpers/development-results.js';
import {
  createHttpErrorHelpers,
  sponsorshipRefundConfirmationText
} from './business-helpers/http-errors.js';
import {
  createMediaExposureHelpers,
  sponsorLogoPublicUrlForFilename,
  sponsorMediaPublicKey
} from './business-helpers/media-exposure.js';
import {
  ADMIN_REVIEW_NOTE_MAX_LENGTH,
  PUBLIC_DISPLAY_NAME_MAX_LENGTH,
  SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH,
  SPONSOR_MESSAGE_MAX_LENGTH,
  SPONSOR_TEXT_MAX_LENGTH,
  amountToCents,
  createRequestValidationHelpers,
  hasOnlyKeys,
  isAllowedSponsorFeedChannel,
  isAllowedSponsorFeedTarget,
  isAllowedSponsorshipStripeRefundReason,
  isBoolean,
  isNonEmptySponsorText,
  isValidAdminExpectedVersion,
  isValidOptionalBoundedText,
  isValidOptionalHttpsUrl,
  isValidOptionalIsoDate,
  isValidOptionalNonEmptyBoundedText,
  isValidSponsorEmail,
  isValidUuid,
  normalizeAmount,
  truncateStripeMetadataValue
} from './business-helpers/request-validation.js';
import {
  createSponsorshipFollowupHelpers,
  createSponsorshipFollowupToken,
  followupEditablePaymentStatuses,
  hashSponsorshipFollowupToken,
  isValidFollowupToken
} from './business-helpers/sponsorship-followup.js';
import { resolvePaymentIntentId as resolveStripePaymentIntentId } from './stripe-object-normalization.js';

const startupConfig = loadApiRuntimeConfig();
const {
  port,
  stripeSecretKey,
  stripeWebhookSecret,
  projectId,
  environment,
  isProduction,
  businessSponsorshipEnabled,
  adminToken,
  adminSessionSecret,
  adminSessionTtlMinutes,
  sponsorshipFollowupTokenTtlDays,
  rateLimitWindowMs,
  publicWriteRateLimitMax,
  sponsorshipFollowupRateLimitMax,
  referenceLookupRateLimitMax,
  referenceRecoveryRateLimitMax,
  adminRateLimitMax,
  emailQueueWorkerEnabled,
  emailQueuePollIntervalMs,
  emailQueueBatchSize,
  adminSponsorshipReviewReminderConfig,
  adminAssistantConfig,
  sponsorLogoMaxBytes,
  sponsorMediaStorageConfig
} = startupConfig;
const { adminTokenMatches, createAdminSession, verifyAdminSession } =
  createAdminTokenSessionService({
    adminToken,
    sessionSecret: adminSessionSecret,
    sessionTtlMinutes: adminSessionTtlMinutes,
    isProduction,
    projectId
  });
const sponsorLogoStorage = createSponsorLogoStorage(sponsorMediaStorageConfig);
const sponsorMediaStorage = createSponsorMediaStorage(
  sponsorMediaStorageConfig
);
const httpConfig = loadApiRuntimeHttpConfig();
const runtimeConfig = { ...startupConfig, ...httpConfig };
const {
  sponsorMediaMaxBytes,
  sponsorMediaMaxSupportingImages,
  trustedProxyHops,
  allowedOrigins,
  publicBaseUrl,
  publicBaseOrigin,
  allowedContributionAmounts,
  allowedContributionTypes,
  stripeApiHost,
  navigableSimulatedCheckout,
  stripeOptions,
  stripeBackfillOptions
} = httpConfig;
const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, stripeOptions)
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
        new Stripe(stripeSecretKey, stripeBackfillOptions),
        {
          apiKey: stripeSecretKey,
          projectId,
          environment
        }
      )
    : null;

loadApiRuntimeEmailConfig();
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
const socialPublicationConfig = loadApiRuntimeSocialPublicationConfig();
validateApiRuntimeConfig(runtimeConfig);

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

const { isAllowedContributionType } = createRequestValidationHelpers({
  allowedContributionTypes
});
const { buildContributionCheckoutSuccessUrl } =
  createContributionReferenceHelpers({ publicBaseOrigin });
const {
  getSponsorLogoFilenameFromUrl,
  deleteControlledSponsorLogoFile,
  sponsorMediaPublicUrl,
  routeAssetId,
  deleteSponsorMediaObjects
} = createMediaExposureHelpers({
  publicBaseOrigin,
  sponsorLogoStorage,
  sponsorMediaStorage,
  reportWarning: (message, details) => console.warn(message, details)
});
const {
  writeSponsorMediaMutationFailure,
  writeSponsorshipMutationFailure,
  writeSponsorshipRefundIneligible
} = createHttpErrorHelpers({ writeJson });
const { getFreshSponsorshipFollowupByToken } = createSponsorshipFollowupHelpers(
  {
    sponsorshipFollowupTokenTtlDays,
    stripe,
    getSponsorshipFollowupByTokenHash: (tokenHash, cutoffIso) =>
      getSponsorshipFollowupByTokenHash(dbPool, tokenHash, cutoffIso),
    upsertCheckoutSessionFromWebhook: (input) =>
      upsertCheckoutSessionFromWebhook(dbPool, input),
    reportFailure: (message, error) => console.error(message, error)
  }
);

const socialPublicationRuntime = (): {
  readonly mode: typeof socialPublicationConfig.mode;
  readonly configuredChannels: readonly SponsorFeedChannel[];
} => ({
  mode: socialPublicationConfig.mode,
  configuredChannels: configuredSocialPublicationChannels(
    socialPublicationConfig
  )
});

const adminAuthMode = loadApiRuntimeAdminAuthMode();
if (adminAuthMode === 'oidc' && !dbPool)
  throw new Error('OIDC requires PostgreSQL.');
const adminIdentity =
  adminAuthMode === 'oidc'
    ? new AdminIdentityService(dbPool!, process.env)
    : null;

const {
  resolveAdminAuthorization,
  ensureAdminAuthorization,
  ensureAdminAccess,
  getAdminAuditActor
} = createAdminAuthorization({
  adminIdentity,
  adminTokenConfigured: Boolean(adminToken),
  isProduction,
  hasDatabase,
  verifyAdminSession,
  adminTokenMatches,
  writeJson
});

const recordAdminAssistantAudit = createAssistantAuditRecorder({
  auditAvailable: Boolean(dbPool),
  getAdminAuditActor,
  insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input),
  reportFailure: (message, error) => console.error(message, error)
});

const resolveCheckoutReturnUrl = createCheckoutReturnUrlResolver(runtimeConfig);

const setupDatabasePool = dbPool;
const { getDatabaseConnectionStatus, buildAdminSetupStatus } =
  createAdminSetupHelpers({
    checkDatabaseConnection: setupDatabasePool
      ? () => setupDatabasePool.query('SELECT 1')
      : null,
    getEmailQueueStatus: () => getEmailQueueStatus(dbPool),
    getTransactionalEmailConfigStatus,
    hasDatabase,
    stripeConfigured: Boolean(stripe),
    stripeSecretKeyConfigured: Boolean(stripeSecretKey),
    stripeWebhookSecretConfigured: Boolean(stripeWebhookSecret),
    stripeLiveMode: Boolean(stripeSecretKey?.startsWith('sk_live_')),
    businessSponsorshipEnabled,
    publicBaseUrl,
    publicBaseOrigin,
    allowedOrigins,
    adminSponsorshipReviewReminderConfig,
    emailQueuePollIntervalMs,
    emailQueueBatchSize,
    sponsorshipInvoiceConfig: {
      invoicePrefix: sponsorshipInvoiceConfig.invoicePrefix,
      issuerName: sponsorshipInvoiceConfig.issuerName,
      issuerEmail: sponsorshipInvoiceConfig.issuerEmail,
      taxLabel: sponsorshipInvoiceConfig.taxLabel,
      issuerAddressConfigured: Boolean(sponsorshipInvoiceConfig.issuerAddress),
      issuerTaxIdConfigured: Boolean(sponsorshipInvoiceConfig.issuerTaxId)
    },
    readEnvironment: (key) => process.env[key],
    reportFailure: (message, error) => console.error(message, error)
  });

const publicationAutomation = dbPool
  ? new PublicationAutomationService(dbPool, sponsorMediaStorage)
  : null;
const contributionNotifications = loadApiRuntimeContributionNotificationConfig(
  process.env
);
const contributionActivity = dbPool
  ? new ContributionActivityService(dbPool, contributionNotifications)
  : null;
const adminPilotage =
  dbPool && publicationAutomation
    ? new AdminPilotageService(dbPool, publicationAutomation)
    : null;
const backgroundWorkers = createApiBackgroundWorkers({
  hasDatabase,
  dbPool,
  emailQueueWorkerEnabled,
  emailQueueBatchSize,
  emailQueuePollIntervalMs,
  adminSponsorshipReviewReminderConfig,
  publicBaseUrl,
  processQueuedEmailMessages,
  queueDueSponsorshipReviewReminder,
  buildSponsorshipReviewReminderAdminUrl,
  contributionActivity,
  publicationAutomation
});

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

  backgroundWorkers.start();
});
