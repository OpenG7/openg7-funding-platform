import type { AdminAttentionItem } from '@openg7/funding-core';

import { elapsedDaysSince } from '../../elapsed-days.js';
import {
  sponsorshipAdminUrl,
  sponsorshipRef
} from '../../sponsorship-admin-presentation.js';
import {
  isSponsorshipAwaitingReview,
  missingFicheFields,
  needsSponsorshipInformation
} from '../../sponsorship-review-policy.js';

import type { AttentionDataset } from './contracts.js';
import { severityForAge } from './shared.js';

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
