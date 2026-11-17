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
import { projectSponsorshipPublicationWorkflow } from './sponsorship-progress-workflow.js';
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
    coordinatesComplete &&
    (record.detailsSubmittedAt || record.detailsAdminCompletedAt)
  );
  const { hasApprovedPresentation: imageApproved, pending: pendingMedia } =
    summarizeSponsorshipMedia(source.media);
  const paid = ['paid', 'refunded', 'disputed'].includes(record.paymentStatus);
  const invoice = facts.documents.some((d) => d.kind === 'invoice');
  const commitment = facts.commitment;
  const openWebsite =
    commitment?.obligations.some(
      (obligation) =>
        obligation.channel === 'website' &&
        obligation.target === 'openg7' &&
        !['fulfilled', 'adjusted'].includes(obligation.state)
    ) ?? false;
  const openBenefits = new Set(
    commitment?.obligations
      .filter(
        (obligation) => !['fulfilled', 'adjusted'].includes(obligation.state)
      )
      .map((obligation) => obligation.benefitId)
  );
  const mediaRequirements =
    commitment?.offer?.benefits
      .filter((benefit) => openBenefits.has(benefit.id))
      .flatMap((benefit) => benefit.requiredElements) ?? [];
  const presentationRequired = mediaRequirements.includes(
    'approved_presentation'
  );
  const logoRequired = mediaRequirements.includes('approved_logo');
  const mediaRequired = presentationRequired || logoRequired;
  const requiredMediaMissing =
    (presentationRequired && !imageApproved) ||
    (logoRequired &&
      !source.media.some(
        (asset) => asset.kind === 'logo' && asset.reviewStatus === 'approved'
      ));
  const mediaComplete = !requiredMediaMissing && pendingMedia === 0;
  const mediaRequirementsUnknown =
    (commitment?.state !== 'active' || !commitment.offer) &&
    source.media.length === 0;
  const {
    qualified,
    websiteRequired,
    completion: publicationCompletion,
    complete: publicationComplete,
    blockers: obligationBlockers
  } = projectSponsorshipObligationProgress({
    qualifiedFulfilmentEvidenceIds: facts.qualifiedFulfilmentEvidenceIds ?? [],
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
  // Shared read-only prerequisites; identity belongs to the website, hidden to social.
  const visibilityBlockers = (target: 'website' | 'social'): string[] => [
    ...(!consent ? ['consent'] : []),
    ...(record.reviewStatus !== 'approved' ? ['review'] : []),
    ...(target === 'website' && !record.hasCompanyName ? ['identity'] : []),
    ...(record.paymentStatus !== 'paid' ? ['payment'] : []),
    ...(refundBlocksPublication ? ['refund'] : []),
    ...(target === 'social' && ['hidden'].includes(record.feedStatus)
      ? ['hidden']
      : [])
  ];
  const publicationBlockers = [
    ...new Set([
      ...visibilityBlockers('social'),
      ...obligationBlockers,
      ...(requiredMediaMissing ? ['media'] : [])
    ])
  ];
  const websiteBlockers = visibilityBlockers('website');
  const publicationWorkflow = projectSponsorshipPublicationWorkflow(
    commitment,
    facts.publications,
    [
      ...visibilityBlockers('social'),
      ...(!qualified ? ['commitment_needs_confirmation'] : [])
    ],
    source.dataset?.now,
    facts.qualifiedFulfilmentEvidenceIds ?? []
  );
  // A retired attempt must not override the current passage. Uncertain and
  // in-flight attempts are retained by the workflow until reconciliation.
  const currentPublications = facts.publications.filter((publication) => {
    const selected = publicationWorkflow.obligations.filter(
      (obligation) =>
        obligation.channel === publication.channel &&
        obligation.target === publication.target &&
        obligation.deliveryId
    );
    return (
      !selected.length ||
      selected.some(
        (obligation) => obligation.deliveryId === publication.deliveryId
      )
    );
  });
  const publicationError = currentPublications.some(
    (d) =>
      ['failed', 'uncertain'].includes(d.deliveryStatus ?? '') && !published(d)
  );
  const publicationUncertain = currentPublications.some(
    (d) => d.deliveryStatus === 'uncertain'
  );
  const publicationCancelled = currentPublications.some(
    (d) => !published(d) && cancelled(d)
  );
  const publicationBlocked =
    publicationBlockers.length > 0 ||
    currentPublications.some(
      (d) => d.deliveryStatus === 'blocked' && !published(d)
    );
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
        ? record.detailsSubmittedAt
          ? 'identity_complete'
          : 'identity_admin_completed'
        : coordinatesComplete
          ? 'identity_submission_pending'
          : 'identity_missing',
      tab: 'identity'
    },
    {
      id: 'media',
      state: mediaRequirementsUnknown
        ? 'pending'
        : !mediaRequired &&
            !source.media.length &&
            commitment?.state === 'active'
          ? 'not_required'
          : mediaComplete
            ? 'complete'
            : 'pending',
      reason: mediaRequirementsUnknown
        ? 'media_requirements_unconfirmed'
        : !mediaRequired && !source.media.length
          ? 'media_not_required'
          : requiredMediaMissing && !pendingMedia
            ? 'media_promised_pending'
            : mediaComplete
              ? 'media_approved'
              : 'media_review',
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
      state:
        publicationUncertain ||
        publicationWorkflow.reason === 'fulfilment_unverified'
          ? 'error'
          : publicationComplete
            ? 'complete'
            : !qualified
              ? 'blocked'
              : publicationError
                ? 'error'
                : publicationCancelled
                  ? 'cancelled'
                  : openWebsite &&
                      facts.websiteVisible &&
                      websiteBlockers.length === 0
                    ? 'partial'
                    : publicationBlocked
                      ? 'blocked'
                      : (websiteRequired && facts.websiteVisible) ||
                          facts.publications.some(published)
                        ? 'partial'
                        : 'pending',
      reason: publicationUncertain
        ? 'publication_uncertain'
        : publicationWorkflow.reason === 'fulfilment_unverified'
          ? 'fulfilment_unverified'
          : publicationComplete
            ? 'publication_done'
            : !qualified
              ? 'commitment_needs_confirmation'
              : publicationError
                ? 'publication_failed'
                : publicationCancelled
                  ? 'publication_cancelled'
                  : !consent
                    ? 'consent_missing'
                    : openWebsite &&
                        facts.websiteVisible &&
                        websiteBlockers.length === 0 &&
                        requiredMediaMissing
                      ? 'website_text_visible'
                      : publicationBlocked
                        ? 'publication_blocked'
                        : [
                              'publication_preparation_required',
                              'website_publication_required'
                            ].includes(publicationWorkflow.reason)
                          ? 'publication_pending'
                          : publicationWorkflow.reason,
      tab: 'publication'
    }
  ];
  // Reviewing optional or deferred images must not hide the next text-publication action.
  const outstanding =
    milestones.find(
      (m) =>
        m.id !== 'media' && m.state !== 'complete' && m.state !== 'not_required'
    ) ??
    milestones.find(
      (m) =>
        m.id === 'media' && m.state !== 'complete' && m.state !== 'not_required'
    );
  const textWebsiteNext =
    openWebsite && qualified && websiteBlockers.length === 0
      ? facts.websiteVisible
        ? requiredMediaMissing
          ? { reason: 'media_promised_pending', tab: 'media' as const }
          : null
        : { reason: 'website_publication_required', tab: 'media' as const }
      : null;
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
              : textWebsiteNext
                ? textWebsiteNext
                : outstanding
                  ? { reason: outstanding.reason, tab: outstanding.tab }
                  : { reason: 'complete', tab: 'overview' as const };
  return {
    qualifiedFulfilmentEvidenceIds: facts.qualifiedFulfilmentEvidenceIds ?? [],
    publicationWorkflow,
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
      record.hasCompanyName,
    feedStatus: record.feedStatus,
    publicationCompletion,
    website: {
      refreshObligationId: facts.websiteRefreshObligationId ?? null,
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
