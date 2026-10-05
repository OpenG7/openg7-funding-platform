import { reconcileEmailDelivery } from '../email-delivery-reconciliation.repository.js';
import { createAdminAccountingHttpHandler } from '../admin-accounting.http.js';
import { createAdminAuditHttpHandler } from '../admin-audit.http.js';
import { createAdminBackupsHttpHandler } from '../admin-backups.http.js';
import { createAdminContributionActivityHttpHandler } from '../admin-contribution-activity.http.js';
import { createAdminSessionHttpHandler } from '../admin-session.http.js';
import { createAdminSetupHttpHandler } from '../admin-setup.http.js';
import { createAdminSponsorshipAccessHttpHandler } from '../admin-sponsorship-access.http.js';
import { createAdminSponsorshipRefundHttpHandler } from '../admin-sponsorship-refund.http.js';
import { createAdminStripeBackfillHttpHandler } from '../admin-stripe-backfill.http.js';
import { createAdminAssistantHttpHandler } from '../admin-assistant.http.js';
import { buildAdminAssistantSummary } from '../admin-assistant/attention.service.js';
import { getAdminAssistantContext } from '../admin-assistant/context.service.js';
import { runAdminAssistantQuery } from '../admin-assistant/orchestrator.js';
import { prepareAdminAssistantDraft } from '../admin-assistant/preparation.service.js';
import { getCockpitActivity } from '../admin-cockpit/activity.js';
import { getCockpitMetrics } from '../admin-cockpit/metrics.js';
import {
  ContributionExportError,
  exportAdminContributions
} from '../admin-contributions-export.service.js';
import { createAdminContributionsHttpHandler } from '../admin-contributions.http.js';
import {
  DocumentResendConflict,
  queueAdminDocumentResend
} from '../admin-document-resend.service.js';
import { createAdminDocumentsHttpHandler } from '../admin-documents.http.js';
import { createAdminEmailHttpHandler } from '../admin-email.http.js';
import { createAdminInsightsHttpHandler } from '../admin-insights.http.js';
import { createAdminPilotageHttpHandler } from '../admin-pilotage.http.js';
import { PilotError } from '../admin-pilotage.service.js';
import { createAdminPublicationAutomationHttpHandler } from '../admin-publication-automation.http.js';
import { createAdminPublicationBatchesHttpHandler } from '../admin-publication-batches.http.js';
import { createAdminPublicationDraftsHttpHandler } from '../admin-publication-drafts.http.js';
import { createAdminPublicationSlotsHttpHandler } from '../admin-publication-slots.http.js';
import { parseAdminSearch, searchAdmin } from '../admin-search.service.js';
import { createAdminSponsorshipDecisionsHttpHandler } from '../admin-sponsorship-decisions.http.js';
import { updateAdminSponsorshipDetails } from '../admin-sponsorship-details.service.js';
import { createAdminSponsorshipMediaHttpHandler } from '../admin-sponsorship-media.http.js';
import { createAdminSponsorshipRecordsHttpHandler } from '../admin-sponsorship-records.http.js';
import { AdminStripeBackfillError } from '../admin-stripe-backfill.service.js';
import {
  getAdminStripeEvent,
  validStripeEventId
} from '../admin-stripe-event.service.js';
import {
  getAdminWorkQueue,
  parseWorkQueueQuery
} from '../admin-work-queue.service.js';
import {
  BackupError,
  backupStatus,
  isBackupId,
  requestBackup
} from '../database-backup/service.js';
import {
  EmailConfigurationTestError,
  getAdminEmailQueueMessageById,
  getEmailConfigurationTest,
  isEmailTestRequestId,
  listAdminEmailQueue,
  queueEmailConfigurationTest,
  queuePublicationBatchFullNotification,
  queueSponsorshipCreditNoteEmail,
  queueSponsorshipRefundEmail,
  queueSponsorshipRejectionEmail,
  retryAdminEmailQueueMessage
} from '../email-notification.service.js';
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
} from '../fund-admin.repository.js';
import {
  allowedSponsorFeedChannels,
  allowedSponsorFeedStatuses,
  allowedSponsorshipReviewStatuses,
  clearSponsorshipLogoUrl,
  getAdminDashboard,
  getAdminSponsorshipById,
  getAdminSponsorshipLogoUrl,
  getSponsorshipRefundTarget,
  listAdminContributions,
  listAdminSponsorships,
  updateContributionStatusByPaymentIntent,
  updateSponsorshipLogoUrl,
  updateSponsorshipPublication,
  updateSponsorshipRefundWorkflowStatus,
  updateSponsorshipReview
} from '../fund-contributions.repository.js';
import { getPublicTransparencySummary } from '../fund-transparency.repository.js';
import { PublicationAutomationError } from '../publication-automation/policy.js';
import { getTransactionalEmailConfigStatus } from '../services/email/index.js';
import {
  deleteSponsorMediaAsset,
  getSponsorMediaStorageRecord,
  listSponsorMediaAssets,
  reviewSponsorMediaAsset
} from '../sponsor-media.repository.js';
import {
  getSponsorshipAccessRecipient,
  issueSponsorshipAccess,
  normalizeRecoveryEmail,
  SponsorshipAccessError
} from '../sponsorship-access.service.js';
import {
  renderSponsorshipCreditNotePdf,
  renderSponsorshipInvoicePdf,
  sponsorshipCreditNotePdfFilename,
  sponsorshipInvoicePdfFilename
} from '../sponsorship-document-pdf.service.js';
import { requestSponsorshipInformation } from '../sponsorship-information.service.js';
import {
  getSponsorshipInterventions,
  recordSponsorshipIntervention
} from '../sponsorship-interventions.service.js';
import {
  backfillMissingSponsorshipInvoices,
  createSponsorshipCreditNoteForRefund,
  getAdminSponsorshipCreditNoteById,
  getAdminSponsorshipInvoiceById,
  getSponsorshipCreditNoteById,
  getSponsorshipInvoiceById,
  listAdminSponsorshipInvoices
} from '../sponsorship-invoices.repository.js';
import { getSponsorshipProgress } from '../sponsorship-progress.service.js';
import {
  beginSponsorshipRefundOperation,
  failSponsorshipRefundOperation,
  settleSponsorshipRefundOperation
} from '../sponsorship-refund-operations.js';
import {
  isSponsorshipWebsiteVisibilityRequest,
  setSponsorshipWebsiteVisibility
} from '../sponsorship-website.service.js';
import { createDevelopmentRefundResult } from '../business-helpers/development-results.js';
import { sponsorshipRefundConfirmationText } from '../business-helpers/http-errors.js';
import { sponsorLogoPublicUrlForFilename } from '../business-helpers/media-exposure.js';
import {
  ADMIN_REVIEW_NOTE_MAX_LENGTH,
  SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH,
  SPONSOR_MESSAGE_MAX_LENGTH,
  amountToCents,
  isAllowedSponsorFeedChannel,
  isAllowedSponsorFeedTarget,
  isAllowedSponsorshipStripeRefundReason,
  isNonEmptySponsorText,
  isValidAdminExpectedVersion,
  isValidOptionalBoundedText,
  isValidOptionalHttpsUrl,
  isValidOptionalIsoDate,
  isValidOptionalNonEmptyBoundedText,
  isValidSponsorEmail,
  isValidUuid
} from '../business-helpers/request-validation.js';

import type {
  AdminHttpCompositionContext,
  AdminHttpHandlers
} from './contracts.js';

/** Bind existing admin ports without constructing services or starting work at import. */
export const createAdminHttpHandlers = ({
  dbPool,
  publicBaseOrigin,
  allowedOrigins,
  isProduction,
  stripe,
  sponsorMediaMaxBytes,
  sponsorMediaMaxSupportingImages,
  sponsorLogoMaxBytes,
  sponsorshipFollowupTokenTtlDays,
  ensureAdminAccess,
  getAdminAuditActor,
  ensureAdminAuthorization,
  resolveAdminAuthorization,
  readBody,
  readBodyBuffer,
  writeJson,
  writeCsv,
  writePdf,
  writeBinary,
  readCockpitSystems,
  adminNotificationRecipient,
  sponsorMediaStorage,
  sponsorMediaPublicUrl,
  deleteSponsorMediaObjects,
  writeSponsorMediaMutationFailure,
  sponsorLogoStorage,
  getSponsorLogoFilenameFromUrl,
  deleteControlledSponsorLogoFile,
  writeSponsorshipMutationFailure,
  routeAssetId,
  recordAdminAssistantAudit,
  adminAssistantConfig,
  socialPublicationRuntime,
  adminPilotage,
  adminIdentity,
  publicationAutomation,
  writeSponsorshipRefundIneligible,
  adminStripeBackfill,
  contributionActivity,
  adminTokenConfigured,
  adminTokenMatches,
  createAdminSession,
  buildAdminSetupStatus
}: AdminHttpCompositionContext): AdminHttpHandlers => {
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
    adminNotificationRecipient,
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
    reconcileEmailDelivery: (input, actor) =>
      reconcileEmailDelivery(dbPool, input, actor),
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
      updateSponsorshipReview: (input) =>
        updateSponsorshipReview(dbPool, input),
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
      reviewSponsorMediaAsset: (input) =>
        reviewSponsorMediaAsset(dbPool, input),
      deleteSponsorMediaAsset: (input) =>
        deleteSponsorMediaAsset(dbPool, input),
      sponsorMediaStorage,
      sponsorMediaPublicUrl,
      deleteSponsorMediaObjects,
      writeSponsorMediaMutationFailure,
      getAdminSponsorshipLogoUrl: (id) =>
        getAdminSponsorshipLogoUrl(dbPool, id),
      clearSponsorshipLogoUrl: (input) =>
        clearSponsorshipLogoUrl(dbPool, input),
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
      getPublicationBatchById: (input) =>
        getPublicationBatchById(dbPool, input),
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
      getSponsorshipRefundTarget: (id) =>
        getSponsorshipRefundTarget(dbPool, id),
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

  const handleAdminStripeBackfillRequest = createAdminStripeBackfillHttpHandler(
    {
      publicBaseOrigin,
      allowedOrigins,
      ensureAdminAccess,
      resolveAdminAuthorization,
      getAdminAuditActor,
      readBody,
      writeJson,
      adminStripeBackfill,
      AdminStripeBackfillError
    }
  );

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
    adminTokenConfigured,
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

  return {
    handleAdminContributionsRequest,
    handleAdminDocumentsRequest,
    handleAdminAccountingRequest,
    handleAdminEmailRequest,
    handleAdminInsightsRequest,
    handleAdminSponsorshipRecordsRequest,
    handleAdminSponsorshipDecisionsRequest,
    handleAdminSponsorshipMediaRequest,
    handleAdminAssistantRequest,
    handleAdminPublicationDraftsRequest,
    handleAdminPublicationSlotsRequest,
    handleAdminPublicationBatchesRequest,
    handleAdminPilotageRequest,
    handleAdminPublicationAutomationRequest,
    handleAdminSponsorshipRefundRequest,
    handleAdminStripeBackfillRequest,
    handleAdminContributionActivityRequest,
    handleAdminSessionRequest,
    handleAdminBackupsRequest,
    handleAdminSetupRequest,
    handleAdminAuditRequest,
    handleAdminSponsorshipAccessRequest
  };
};
