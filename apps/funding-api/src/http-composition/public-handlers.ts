import {
  buildContributionReceiptDescription,
  createContributionPublicReference,
  createReferenceRecoveryIdempotencyKey,
  normalizeReferenceRecoveryEmail
} from '../business-helpers/contribution-reference.js';
import { createDevelopmentCheckoutResult } from '../business-helpers/development-results.js';
import { createDurableCheckoutService } from '../checkout-operations.service.js';
import { sponsorLogoPublicUrlForFilename } from '../business-helpers/media-exposure.js';
import {
  PUBLIC_DISPLAY_NAME_MAX_LENGTH,
  SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH,
  SPONSOR_MESSAGE_MAX_LENGTH,
  SPONSOR_TEXT_MAX_LENGTH,
  hasOnlyKeys,
  isBoolean,
  isNonEmptySponsorText,
  isValidAdminExpectedVersion,
  isValidOptionalBoundedText,
  isValidOptionalHttpsUrl,
  isValidSponsorEmail,
  isValidUuid,
  normalizeAmount,
  truncateStripeMetadataValue
} from '../business-helpers/request-validation.js';
import {
  createSponsorshipFollowupToken,
  followupEditablePaymentStatuses,
  hashSponsorshipFollowupToken,
  isValidFollowupToken
} from '../business-helpers/sponsorship-followup.js';
import { queueContributionReferenceRecoveryEmail } from '../email-notification.service.js';
import {
  getPublicSponsorshipBatchAvailability,
  insertAdminAuditLog
} from '../fund-admin.repository.js';
import {
  isPublicApprovedSponsorshipLogoUrl,
  listContributionReferencesByEmail,
  listPublicSponsorships,
  lookupPublicContributionReference,
  recordSponsorshipDetails
} from '../fund-contributions.repository.js';
import {
  getPublicTransparencySummary,
  listPublicBuilders
} from '../fund-transparency.repository.js';
import { createLegacySponsorshipDetailsHttpHandler } from '../legacy-sponsorship-details.http.js';
import { createPublicFundingHttpHandler } from '../public-funding.http.js';
import { createPublicPaymentsHttpHandler } from '../public-payments.http.js';
import { createPublicReferencesHttpHandlers } from '../public-references.http.js';
import { createPublicSponsorMediaHttpHandler } from '../public-sponsor-media.http.js';
import { processSponsorImage } from '../sponsor-image.service.js';
import {
  checkSponsorMediaUpload,
  createSponsorMediaAsset,
  deleteSponsorMediaAsset,
  getApprovedPublicSponsorMedia,
  getSponsorMediaStorageRecord,
  listSponsorMediaAssets
} from '../sponsor-media.repository.js';
import {
  getSponsorshipDraft,
  normalizeRecoveryEmail,
  recoverSponsorshipAccess,
  saveSponsorshipDraft,
  SponsorshipAccessError,
  submitSponsorshipDraft
} from '../sponsorship-access.service.js';
import { createSponsorshipFollowupMediaHttpHandler } from '../sponsorship-followup-media.http.js';
import { createSponsorshipFollowupHttpHandler } from '../sponsorship-followup.http.js';
import { resolvePaymentIntentId as resolveStripePaymentIntentId } from '../stripe-object-normalization.js';
import { createStripeWebhookHttpHandler } from '../stripe-webhook.http.js';
import { processStripeWebhook } from '../stripe-webhook.service.js';

import type {
  PublicHttpCompositionContext,
  PublicHttpHandlers
} from './contracts.js';

/** Bind existing public handlers without creating runtime resources or dispatching requests. */
export const createPublicHttpHandlers = ({
  publicBaseOrigin,
  dbPool,
  hasDatabase,
  stripe,
  stripeWebhookSecret,
  publicBaseUrl,
  projectId,
  isProduction,
  businessSponsorshipEnabled,
  allowedContributionAmounts,
  stripeApiHost,
  navigableSimulatedCheckout,
  sponsorshipFollowupTokenTtlDays,
  sponsorMediaMaxBytes,
  sponsorMediaMaxSupportingImages,
  readBody,
  readBodyBuffer,
  writeJson,
  writeBinary,
  isAllowedContributionType,
  resolveCheckoutReturnUrl,
  buildContributionCheckoutSuccessUrl,
  getFreshSponsorshipFollowupByToken,
  routeAssetId,
  getSponsorLogoFilenameFromUrl,
  sponsorMediaStorage,
  sponsorLogoStorage,
  deleteSponsorMediaObjects,
  writeSponsorMediaMutationFailure,
  readStripeTransparency
}: PublicHttpCompositionContext): PublicHttpHandlers => {
  const handleSponsorshipFollowupRequest = createSponsorshipFollowupHttpHandler(
    {
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
        error === undefined
          ? console.error(message)
          : console.error(message, error)
    }
  );

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
      createSponsorMediaAsset: (input) =>
        createSponsorMediaAsset(dbPool, input),
      deleteSponsorMediaAsset: (input) =>
        deleteSponsorMediaAsset(dbPool, input),
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
      error === undefined
        ? console.error(message)
        : console.error(message, error)
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
    runCheckout: createDurableCheckoutService(dbPool, stripe),
    reportFailure: (message, code) => console.error(message, code)
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

  // Dispatch order belongs to the dispatcher, which interleaves both groups.
  return {
    handlePublicFundingRequest,
    handlePublicPaymentsRequest,
    handleReferenceLookupRequest,
    handleReferenceRecoveryRequest,
    handlePublicSponsorMediaRequest,
    handleSponsorshipFollowupRequest,
    handleSponsorshipFollowupMediaRequest,
    handleLegacySponsorshipDetailsRequest,
    handleStripeWebhookRequest
  };
};
