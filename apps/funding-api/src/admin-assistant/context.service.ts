import type {
  AdminAssistantContext,
  AdminAssistantContextResponse,
  AdminAssistantMode,
  AdminAssistantNextStep
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { getAdminWorkQueue } from '../admin-work-queue.service.js';

import {
  activeDraftChannels,
  isActionableSponsorship,
  missingFicheFields,
  promisedSocialChannels,
  sponsorshipAdminUrl,
  sponsorshipRef
} from './attention.service.js';
import {
  loadSponsorshipAssistantDataset,
  type SponsorshipAssistantDataset
} from './context.repository.js';

export const canRequestSponsorshipInformation = (
  source: SponsorshipAssistantDataset
): boolean =>
  isActionableSponsorship(source.record) &&
  source.record.reviewStatus !== 'rejected' &&
  missingFicheFields(source.record).length > 0 &&
  Boolean(
    source.recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(source.recipient)
  );

export const buildSponsorshipAssistantContext = (
  source: SponsorshipAssistantDataset
): AdminAssistantContext => {
  const { record, dataset } = source;
  const missingFields = missingFicheFields(record);
  const promised = promisedSocialChannels(record.amount);
  const covered = [
    ...activeDraftChannels(dataset.drafts, record.contributionId)
  ];
  const media = {
    total: source.media.length,
    approved: source.media.filter((asset) => asset.reviewStatus === 'approved')
      .length,
    pending: source.media.filter(
      (asset) => asset.reviewStatus === 'pending_review'
    ).length,
    rejected: source.media.filter((asset) => asset.reviewStatus === 'rejected')
      .length
  };
  let nextStep: AdminAssistantNextStep;
  if (record.refundStatus !== 'not_requested') nextStep = 'check_refund';
  else if (record.paymentStatus !== 'paid') nextStep = 'check_payment';
  else if (record.reviewStatus === 'rejected') nextStep = 'review_rejection';
  else if (missingFields.length) nextStep = 'complete_information';
  else if (
    media.pending ||
    !source.media.some(
      (asset) =>
        asset.kind === 'supporting_image' && asset.reviewStatus === 'approved'
    )
  )
    nextStep = 'review_media';
  else if (record.reviewStatus === 'pending_review')
    nextStep = 'review_sponsorship';
  else if (!source.consent) nextStep = 'confirm_consent';
  else if (promised.some((channel) => !covered.includes(channel)))
    nextStep = 'prepare_publication';
  else if (
    dataset.drafts.some(
      (draft) =>
        draft.status !== 'published' &&
        draft.status !== 'cancelled' &&
        draft.status !== 'rejected'
    )
  )
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
    promisedChannels: promised,
    coveredChannels: covered,
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
