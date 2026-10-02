import type {
  AdminAssistantContext,
  AdminAssistantContextResponse,
  AdminAssistantMode,
  AdminAssistantNextStep
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { getAdminWorkQueue } from '../admin-work-queue.service.js';
import {
  sponsorshipAdminUrl,
  sponsorshipRef
} from '../sponsorship-admin-presentation.js';
import { summarizeSponsorshipMedia } from '../sponsorship-media-policy.js';
import {
  isUnfinishedPublicationDraft,
  resolveSponsorshipPublicationCoverage
} from '../sponsorship-publication-coverage.js';
import {
  canRequestSponsorshipInformation,
  missingFicheFields
} from '../sponsorship-review-policy.js';

import {
  loadSponsorshipAssistantDataset,
  type SponsorshipAssistantDataset
} from './context.repository.js';

export { canRequestSponsorshipInformation } from '../sponsorship-review-policy.js';

export const buildSponsorshipAssistantContext = (
  source: SponsorshipAssistantDataset
): AdminAssistantContext => {
  const { record, dataset } = source;
  const missingFields = missingFicheFields(record);
  const { promisedChannels, coveredChannels, missingChannels } =
    resolveSponsorshipPublicationCoverage(record, dataset.drafts);
  const { hasApprovedPresentation, ...media } = summarizeSponsorshipMedia(
    source.media
  );
  let nextStep: AdminAssistantNextStep;
  if (record.refundStatus !== 'not_requested') nextStep = 'check_refund';
  else if (record.paymentStatus !== 'paid') nextStep = 'check_payment';
  else if (record.reviewStatus === 'rejected') nextStep = 'review_rejection';
  else if (missingFields.length) nextStep = 'complete_information';
  else if (media.pending || !hasApprovedPresentation) nextStep = 'review_media';
  else if (record.reviewStatus === 'pending_review')
    nextStep = 'review_sponsorship';
  else if (!source.consent) nextStep = 'confirm_consent';
  else if (missingChannels.length) nextStep = 'prepare_publication';
  else if (dataset.drafts.some(isUnfinishedPublicationDraft))
    nextStep = 'monitor_publication';
  else nextStep = 'complete';
  return {
    contributionId: record.contributionId,
    reference: sponsorshipRef(record),
    version: source.version,
    paymentStatus: record.paymentStatus,
    refundStatus: record.refundStatus,
    reviewStatus: record.reviewStatus,
    feedStatus: record.feedStatus,
    publicConsent: source.consent,
    missingFields,
    media,
    promisedChannels,
    coveredChannels,
    nextStep,
    adminUrl: sponsorshipAdminUrl(record.contributionId),
    canRequestInformation: canRequestSponsorshipInformation(source)
  };
};

export const getAdminAssistantContext = async (
  pool: Pool | null,
  sponsorshipId?: string,
  conversationMode: AdminAssistantMode = 'disabled',
  now = new Date()
): Promise<AdminAssistantContextResponse> => {
  const base = { generatedAt: now.toISOString(), conversationMode };
  if (!pool) return { ...base, status: 'unavailable', context: null };
  let reference = sponsorshipId;
  if (!reference) {
    const queue = await getAdminWorkQueue(pool, {}, now);
    if (!queue.available)
      return { ...base, status: 'unavailable', context: null };
    reference = queue.firstSponsorshipId ?? undefined;
    if (!reference) return { ...base, status: 'empty', context: null };
  }
  const source = await loadSponsorshipAssistantDataset(pool, reference, now);
  return source
    ? {
        ...base,
        status: 'ok',
        context: buildSponsorshipAssistantContext(source)
      }
    : { ...base, status: 'not_found', context: null };
};
