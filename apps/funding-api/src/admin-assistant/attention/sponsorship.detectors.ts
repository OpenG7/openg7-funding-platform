import type { AdminAttentionItem } from '@openg7/funding-core';

import { elapsedDaysSince } from '../../elapsed-days.js';
import {
  sponsorshipAdminUrl,
  sponsorshipRef
} from '../../sponsorship-admin-presentation.js';
import {
  isActionableSponsorship,
  isSponsorshipAwaitingReview,
  missingFicheFields,
  needsSponsorshipInformation
} from '../../sponsorship-review-policy.js';

import type { AttentionDataset, AttentionMediaRecord } from './contracts.js';
import { severityForAge } from './shared.js';

/** Current facts keep the work visible across visits; no notification or approval is inferred. */
export const detectSponsorshipMediaReviewItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] => {
  const mediaByDossier = new Map<string, AttentionMediaRecord[]>();
  for (const asset of dataset.media ?? []) {
    const group = mediaByDossier.get(asset.contributionId) ?? [];
    group.push(asset);
    mediaByDossier.set(asset.contributionId, group);
  }
  return dataset.sponsorships.flatMap((record) => {
    if (!isActionableSponsorship(record) || record.reviewStatus === 'rejected')
      return [];
    const media = mediaByDossier.get(record.contributionId) ?? [];
    const review = media.filter((asset) => asset.authorization === 'confirmed');
    const waiting = media.filter((asset) => asset.authorization === 'required');
    const current = review.length ? review : waiting;
    if (!current.length) return [];
    const phase = review.length ? 'review' : 'waiting';
    const changedAt = current.map((asset) => asset.changedAt).sort()[0]!;
    const daysWaiting = Math.max(
      0,
      elapsedDaysSince(dataset.now, changedAt) ?? 0
    );
    return [
      {
        id: `sponsorship_media_review:${record.contributionId}`,
        type: 'sponsorship_media_review',
        severity:
          phase === 'waiting'
            ? 'informational'
            : daysWaiting >= 7
              ? 'urgent'
              : 'today',
        title:
          phase === 'review'
            ? `Médias autorisés à examiner (${sponsorshipRef(record)})`
            : `Autorisation des médias à obtenir (${sponsorshipRef(record)})`,
        explanation:
          phase === 'review'
            ? `${review.length} média(s) disposent de droits confirmés et attendent une revue. Leur approbation reste une décision administrative distincte.`
            : `${waiting.length} média(s) attendent une autorisation d’utilisation. Cet état ne confirme pas qu’une demande a été envoyée.`,
        sponsorshipId: record.contributionId,
        contributionId: record.contributionId,
        detectedAt: changedAt,
        adminUrl: sponsorshipAdminUrl(record.contributionId, 'media'),
        facts: {
          reference: sponsorshipRef(record),
          phase,
          reviewCount: review.length,
          authorizationRequiredCount: waiting.length,
          missingAltCount: review.filter((asset) => asset.missingAlt).length,
          changedAt,
          daysWaiting,
          tab: 'media'
        },
        suggestedActions: [
          {
            actionType: 'open_sponsorship',
            label:
              phase === 'review'
                ? 'Examiner les médias'
                : 'Consulter les autorisations',
            executionMode: 'navigate'
          }
        ]
      } satisfies AdminAttentionItem
    ];
  });
};

// ---------------------------------------------------------------------------
// Detector: sponsorship paid but fiche incomplete.
// ---------------------------------------------------------------------------
export const detectSponsorshipInfoItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.sponsorships.filter(needsSponsorshipInformation).map((record) => {
    const ageDays = elapsedDaysSince(dataset.now, record.paidAt);
    const missing = missingFicheFields(record);
    return {
      id: `sponsorship_needs_info:${record.contributionId}`,
      type: 'sponsorship_needs_info',
      severity: severityForAge(ageDays, 7, 2),
      title: `Commandite payée sans fiche complète (${sponsorshipRef(record)})`,
      explanation:
        `Une commandite de ${record.amount} ${record.currency} est payée ` +
        `mais sa fiche commanditaire est incomplète. ` +
        `Éléments manquants : ${missing.join(', ')}.`,
      sponsorshipId: record.contributionId,
      contributionId: record.contributionId,
      detectedAt: dataset.now.toISOString(),
      adminUrl: sponsorshipAdminUrl(record.contributionId),
      facts: {
        reference: sponsorshipRef(record),
        amount: record.amount,
        currency: record.currency,
        paidAt: record.paidAt,
        daysSincePaid: ageDays,
        detailsSubmitted: record.detailsSubmittedAt !== null,
        missingFields: missing.join(', ')
      },
      suggestedActions: [
        {
          actionType: 'prepare_reminder',
          label: 'Préparer une relance',
          executionMode: 'prepare'
        },
        {
          actionType: 'open_sponsorship',
          label: 'Ouvrir la commandite',
          executionMode: 'navigate'
        }
      ]
    } satisfies AdminAttentionItem;
  });

// ---------------------------------------------------------------------------
// Detector: sponsorship complete, awaiting an administrative review decision.
// ---------------------------------------------------------------------------
export const detectSponsorshipReviewItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.sponsorships.filter(isSponsorshipAwaitingReview).map((record) => {
    const ageDays = elapsedDaysSince(
      dataset.now,
      record.detailsSubmittedAt ?? record.paidAt
    );
    return {
      id: `sponsorship_needs_review:${record.contributionId}`,
      type: 'sponsorship_needs_review',
      severity: severityForAge(ageDays, 7, 3),
      title: `Commandite en attente de revue (${sponsorshipRef(record)})`,
      explanation:
        `Une commandite de ${record.amount} ${record.currency} a une fiche ` +
        `complète mais aucune décision administrative (approbation ou refus) ` +
        `n'a encore été enregistrée.`,
      sponsorshipId: record.contributionId,
      contributionId: record.contributionId,
      detectedAt: dataset.now.toISOString(),
      adminUrl: sponsorshipAdminUrl(record.contributionId),
      facts: {
        reference: sponsorshipRef(record),
        amount: record.amount,
        currency: record.currency,
        detailsSubmittedAt: record.detailsSubmittedAt,
        daysWaiting: ageDays
      },
      suggestedActions: [
        {
          actionType: 'prepare_note',
          label: 'Préparer une note',
          executionMode: 'prepare'
        },
        {
          actionType: 'review_sponsorship',
          label: 'Réviser la commandite',
          executionMode: 'navigate'
        }
      ]
    } satisfies AdminAttentionItem;
  });

/** Unknown historical terms require human qualification; an absent offer is never completion. */
export const detectSponsorshipCommitmentItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.sponsorships
    .filter(
      (record) =>
        record.paymentStatus === 'paid' &&
        record.refundStatus === 'not_requested' &&
        (record.commitment?.state !== 'active' || !record.commitment.offer)
    )
    .map(
      (record) =>
        ({
          id: `sponsorship_needs_commitment:${record.contributionId}`,
          type: 'sponsorship_needs_commitment',
          severity: 'this_week',
          title: `Engagements à qualifier (${sponsorshipRef(record)})`,
          explanation:
            'Aucune offre qualifiée n’est enregistrée. Vérifier l’accord et ses preuves sans appliquer le barème actuel.',
          sponsorshipId: record.contributionId,
          contributionId: record.contributionId,
          detectedAt: dataset.now.toISOString(),
          adminUrl: sponsorshipAdminUrl(record.contributionId),
          facts: {
            reference: sponsorshipRef(record),
            commitmentState: record.commitment?.state ?? 'needs_confirmation'
          },
          suggestedActions: [
            {
              actionType: 'qualify_commitment',
              label: 'Examiner les engagements',
              executionMode: 'navigate'
            }
          ]
        }) satisfies AdminAttentionItem
    );
