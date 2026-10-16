import type {
  AdminSponsorshipProgress,
  AdminSponsorshipProgressResponse,
  SponsorshipMilestone,
  SponsorshipProgressPublication
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import {
  sponsorshipAdminUrl,
  sponsorshipRef
} from './sponsorship-admin-presentation.js';
import { summarizeSponsorshipMedia } from './sponsorship-media-policy.js';
import {
  loadSponsorshipAssistantDataset,
  type SponsorshipAssistantDataset
} from './admin-assistant/context.repository.js';
import { resolveSponsorshipSelection } from './admin-work-queue.service.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { projectSponsorshipObligationProgress } from './sponsorship-progress-obligations.js';
import { projectSponsorshipRefundProgress } from './sponsorship-refund-progress.js';
import {
  findSponsorshipPreparationActivityId,
  loadSponsorshipProgressFacts,
  type SponsorshipProgressFacts
} from './sponsorship-progress.repository.js';

export type { SponsorshipProgressFacts } from './sponsorship-progress.repository.js';

/** Pure projection. A later milestone never completes an earlier milestone. */
export const buildSponsorshipProgress = (
  source: SponsorshipAssistantDataset,
  facts: SponsorshipProgressFacts
): AdminSponsorshipProgress => {
  const { record, consent } = source;
  const currency = record.currency.toUpperCase();
  const refund = projectSponsorshipRefundProgress(record, facts);
  const { confirmedAmountMinor, creditMissing, hasError: refundError } = refund;
  const refundInProgress = ['requested', 'processing'].includes(
    record.refundStatus
  );
  const refundBlocksPublication =
    confirmedAmountMinor >= facts.amountMinor || refundInProgress;
  const coordinatesComplete = record.hasCompanyName && record.hasContactEmail;
  const identityComplete = Boolean(
    record.detailsSubmittedAt && coordinatesComplete
  );
  const { hasApprovedPresentation: imageApproved, pending: pendingMedia } =
    summarizeSponsorshipMedia(source.media);
  const mediaComplete = imageApproved && pendingMedia === 0;
  const paid = ['paid', 'refunded', 'disputed'].includes(record.paymentStatus);
  const invoice = facts.documents.some((d) => d.kind === 'invoice');
  const commitment = facts.commitment;
  const {
    qualified,
    websiteRequired,
    completion: publicationCompletion,
    complete: publicationComplete,
    blockers: obligationBlockers
  } = projectSponsorshipObligationProgress({
    commitment,
    amountMinor: facts.amountMinor,
    currency,
    hasCompanyName: record.hasCompanyName,
    media: source.media
  });
  const cancelled = (d: SponsorshipProgressPublication) =>
    d.deliveryStatus === 'cancelled' ||
    d.deliveryStatus === 'rejected' ||
    d.status === 'cancelled' ||
    d.status === 'rejected' ||
    d.batchStatus === 'cancelled' ||
    d.slotStatus === 'cancelled';
  const published = (d: SponsorshipProgressPublication) =>
    (d.status === 'published' && d.deliveryMode !== 'mock') ||
    (d.deliveryStatus === 'published' && d.deliveryMode === 'live');
  const publicationError = facts.publications.some(
    (d) =>
      ['failed', 'uncertain'].includes(d.deliveryStatus ?? '') && !published(d)
  );
  const publicationCancelled = facts.publications.some(
    (d) => !published(d) && cancelled(d)
  );
  // Shared read-only prerequisites; identity belongs to the website, hidden to social.
  const visibilityBlockers = (target: 'website' | 'social'): string[] => [
    ...(!consent ? ['consent'] : []),
    ...(record.reviewStatus !== 'approved' ? ['review'] : []),
    ...(target === 'website' && !record.hasCompanyName ? ['identity'] : []),
    ...(!imageApproved ? ['media'] : []),
    ...(record.paymentStatus !== 'paid' ? ['payment'] : []),
    ...(refundBlocksPublication ? ['refund'] : []),
    ...(target === 'social' && ['hidden'].includes(record.feedStatus)
      ? ['hidden']
      : [])
  ];
  const publicationBlockers = [
    ...new Set([...visibilityBlockers('social'), ...obligationBlockers])
  ];
  const publicationBlocked =
    publicationBlockers.length > 0 ||
    facts.publications.some(
      (d) => d.deliveryStatus === 'blocked' && !published(d)
    );
  const websiteBlockers = visibilityBlockers('website');
  const milestones: SponsorshipMilestone[] = [
    {
      id: 'payment',
      state:
        record.paymentStatus === 'disputed'
          ? 'error'
          : paid
            ? 'complete'
            : ['cancelled', 'expired'].includes(record.paymentStatus)
              ? 'cancelled'
              : record.paymentStatus === 'failed'
                ? 'error'
                : 'pending',
      reason:
        record.paymentStatus === 'disputed'
          ? 'payment_disputed'
          : paid
            ? 'payment_recorded'
            : 'payment_unconfirmed',
      tab: 'overview'
    },
    {
      id: 'identity',
      state: identityComplete
        ? 'complete'
        : coordinatesComplete
          ? 'pending'
          : 'blocked',
      reason: identityComplete
        ? 'identity_complete'
        : coordinatesComplete
          ? 'identity_submission_pending'
          : 'identity_missing',
      tab: 'identity'
    },
    {
      id: 'media',
      state: mediaComplete
        ? 'complete'
        : pendingMedia > 0
          ? 'pending'
          : 'blocked',
      reason: mediaComplete ? 'media_approved' : 'media_review',
      tab: 'media'
    },
    {
      id: 'review',
      state:
        record.reviewStatus === 'approved'
          ? 'complete'
          : record.reviewStatus === 'rejected'
            ? 'blocked'
            : 'pending',
      reason:
        record.reviewStatus === 'approved'
          ? 'review_approved'
          : record.reviewStatus === 'rejected'
            ? 'review_rejected'
            : 'review_pending',
      tab: 'overview'
    },
    {
      id: 'billing',
      state: creditMissing
        ? 'blocked'
        : invoice
          ? 'complete'
          : paid && facts.requiresInvoice
            ? 'blocked'
            : 'not_required',
      reason: creditMissing
        ? 'credit_missing'
        : invoice
          ? 'invoice_issued'
          : !facts.requiresInvoice
            ? 'invoice_not_required'
            : paid
              ? 'invoice_missing'
              : 'invoice_waiting',
      tab: 'billing'
    },
    {
      id: 'publication',
      state: publicationComplete
        ? 'complete'
        : !qualified
          ? 'blocked'
          : publicationError
            ? 'error'
            : publicationCancelled
              ? 'cancelled'
              : publicationBlocked
                ? 'blocked'
                : (websiteRequired && facts.websiteVisible) ||
                    facts.publications.some(published)
                  ? 'partial'
                  : 'pending',
      reason: publicationComplete
        ? 'publication_done'
        : !qualified
          ? 'commitment_needs_confirmation'
          : publicationError
            ? 'publication_failed'
            : publicationCancelled
              ? 'publication_cancelled'
              : !consent
                ? 'consent_missing'
                : publicationBlocked
                  ? 'publication_blocked'
                  : 'publication_pending',
      tab: 'publication'
    }
  ];
  const outstanding = milestones.find(
    (m) => m.state !== 'complete' && m.state !== 'not_required'
  );
  const emailIncident =
    facts.failedEmails.find((email) => email.status !== 'uncertain') ??
    facts.failedEmails[0];
  const next =
    refundError || refundInProgress
      ? { reason: 'refund_check', tab: 'refund' as const }
      : creditMissing
        ? { reason: 'credit_missing', tab: 'billing' as const }
        : facts.failedStripeEvents.length
          ? { reason: 'stripe_failed', tab: 'overview' as const }
          : emailIncident
            ? {
                reason:
                  emailIncident.status === 'uncertain'
                    ? 'email_uncertain'
                    : 'email_failed',
                tab: 'billing' as const
              }
            : record.reviewStatus === 'rejected'
              ? { reason: 'review_rejected', tab: 'overview' as const }
              : outstanding
                ? { reason: outstanding.reason, tab: outstanding.tab }
                : { reason: 'complete', tab: 'overview' as const };
  return {
    contributionId: record.contributionId,
    commitment: commitment ?? null,
    fulfilmentEvidence: facts.fulfilmentEvidence ?? [],
    reference: sponsorshipRef(record),
    companyName: facts.companyName,
    version: source.version,
    amountMinor: facts.amountMinor,
    currency,
    paymentStatus: record.paymentStatus,
    reviewStatus: record.reviewStatus,
    publicConsent: consent,
    publicEligible:
      paid &&
      consent &&
      record.reviewStatus === 'approved' &&
      record.hasCompanyName &&
      imageApproved,
    feedStatus: record.feedStatus,
    publicationCompletion,
    website: {
      visible: facts.websiteVisible,
      held: facts.websiteHeld,
      canPublish: websiteBlockers.length === 0,
      version: facts.websiteVersion,
      blockers: websiteBlockers
    },
    publicationBlockers,
    milestones,
    next: {
      ...next,
      adminUrl: sponsorshipAdminUrl(record.contributionId, next.tab)
    },
    documents: facts.documents.map(
      ({ id, number, kind, amountMinor, currency, issuedAt }) => ({
        id,
        number,
        kind,
        amountMinor,
        currency,
        issuedAt
      })
    ),
    publications: facts.publications,
    refund,
    failedEmails: facts.failedEmails,
    failedStripeEvents: facts.failedStripeEvents
  };
};

export const getSponsorshipProgress = async (
  pool: Pool | null,
  id?: string,
  now = new Date()
): Promise<AdminSponsorshipProgressResponse> => {
  const base = { generatedAt: now.toISOString(), dossier: null };
  if (!pool) return { ...base, status: 'unavailable' };
  const selection = await resolveSponsorshipSelection(pool, id, now);
  if (selection.status !== 'selected')
    return { ...base, status: selection.status };
  return withPostgresTransaction<AdminSponsorshipProgressResponse>(
    pool,
    async (client) => {
      const source = await loadSponsorshipAssistantDataset(
        client,
        selection.sponsorshipId,
        now
      );
      if (!source) return { ...base, status: 'not_found' };
      const contributionId = source.record.contributionId;
      const facts = await loadSponsorshipProgressFacts(client, contributionId);
      const dossier = buildSponsorshipProgress(source, facts);
      const preparationActivityId = await findSponsorshipPreparationActivityId(
        client,
        contributionId
      );
      return {
        ...base,
        status: 'ok',
        dossier: {
          ...dossier,
          preparationActivityId
        }
      };
    },
    { readOnlySnapshot: true }
  );
};
