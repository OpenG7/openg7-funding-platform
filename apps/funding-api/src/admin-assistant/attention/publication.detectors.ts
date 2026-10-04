import type { AdminAttentionItem } from '@openg7/funding-core';

import { elapsedDaysSince } from '../../elapsed-days.js';
import { sponsorshipRef } from '../../sponsorship-admin-presentation.js';
import { resolveSponsorshipPublicationCoverage } from '../../sponsorship-publication-coverage.js';
import { isApprovedActionableSponsorship } from '../../sponsorship-review-policy.js';

import type { AttentionDataset } from './contracts.js';
import { ADMIN_URLS, severityForAge } from './shared.js';

// ---------------------------------------------------------------------------
// Detector: approved sponsorship whose promised social publications are not
// yet covered by an active draft. Publication benefits are derived server-side
// from the shared sponsorship policy and the amount actually paid.
// ---------------------------------------------------------------------------
export const detectPublicationPreparationItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.sponsorships
    .filter(isApprovedActionableSponsorship)
    .flatMap((record) => {
      const { promisedChannels: promised, missingChannels } =
        resolveSponsorshipPublicationCoverage(record, dataset.drafts);
      if (missingChannels.length === 0) {
        return [];
      }
      return [
        {
          id: `publication_needs_preparation:${record.contributionId}`,
          type: 'publication_needs_preparation',
          severity: 'this_week',
          title: `Publication à préparer (${sponsorshipRef(record)})`,
          explanation:
            `Cette commandite approuvée de ${record.amount} ${record.currency} ` +
            `prévoit des publications (${promised.join(', ')}). Aucun brouillon ` +
            `actif ne couvre encore : ${missingChannels.join(', ')}.`,
          sponsorshipId: record.contributionId,
          contributionId: record.contributionId,
          detectedAt: dataset.now.toISOString(),
          adminUrl: ADMIN_URLS.publications,
          facts: {
            reference: sponsorshipRef(record),
            amount: record.amount,
            currency: record.currency,
            promisedChannels: promised.join(', '),
            missingChannels: missingChannels.join(', ')
          },
          suggestedActions: [
            {
              actionType: 'prepare_publication',
              label: 'Préparer le brouillon de publication',
              executionMode: 'prepare'
            },
            {
              actionType: 'open_publications',
              label: 'Ouvrir les publications',
              executionMode: 'navigate'
            }
          ]
        } satisfies AdminAttentionItem
      ];
    });

// ---------------------------------------------------------------------------
// Detector: publications past their scheduled time that are neither published
// nor cancelled. Sourced from slots and batches (they carry the schedule).
// ---------------------------------------------------------------------------
export const detectLatePublicationItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] => {
  const items: AdminAttentionItem[] = [];

  for (const slot of dataset.slots) {
    if (slot.status !== 'open' && slot.status !== 'scheduled') {
      continue;
    }
    const daysLate = elapsedDaysSince(dataset.now, slot.startsAt);
    if (daysLate === null || daysLate < 0) {
      continue;
    }
    items.push({
      id: `publication_late:slot:${slot.id}`,
      type: 'publication_late',
      severity: severityForAge(daysLate, 2, 0),
      title: `Créneau de publication dépassé (${slot.channel} · ${slot.feedTarget})`,
      explanation:
        `Le créneau ${slot.channel}/${slot.feedTarget} prévu le ${slot.startsAt} ` +
        `est dépassé et n'est ni publié ni annulé (${slot.capacityUsed}/${slot.capacity} placements).`,
      publicationId: slot.id,
      detectedAt: dataset.now.toISOString(),
      dueAt: slot.startsAt,
      adminUrl: ADMIN_URLS.publications,
      facts: {
        kind: 'slot',
        channel: slot.channel,
        feedTarget: slot.feedTarget,
        startsAt: slot.startsAt,
        status: slot.status,
        daysLate,
        capacityUsed: slot.capacityUsed,
        capacity: slot.capacity
      },
      suggestedActions: [
        {
          actionType: 'propose_slot',
          label: 'Proposer un créneau',
          executionMode: 'prepare'
        },
        {
          actionType: 'open_publication_slot',
          label: 'Ouvrir le créneau',
          executionMode: 'navigate'
        }
      ]
    });
  }

  for (const batch of dataset.batches) {
    if (batch.status !== 'scheduled') {
      continue;
    }
    const daysLate = elapsedDaysSince(dataset.now, batch.scheduledAt);
    if (daysLate === null || daysLate < 0) {
      continue;
    }
    items.push({
      id: `publication_late:batch:${batch.id}`,
      type: 'publication_late',
      severity: severityForAge(daysLate, 2, 0),
      title: `Lot de publication dépassé (${batch.channel})`,
      explanation:
        `Le lot ${batch.channel} planifié le ${batch.scheduledAt} est dépassé ` +
        `et n'est ni publié ni annulé (${batch.capacityUsed}/${batch.capacity} placements).`,
      publicationId: batch.id,
      detectedAt: dataset.now.toISOString(),
      dueAt: batch.scheduledAt ?? undefined,
      adminUrl: ADMIN_URLS.publications,
      facts: {
        kind: 'batch',
        channel: batch.channel,
        scheduledAt: batch.scheduledAt,
        status: batch.status,
        daysLate,
        capacityUsed: batch.capacityUsed,
        capacity: batch.capacity
      },
      suggestedActions: [
        {
          actionType: 'open_publication_batch',
          label: 'Ouvrir le lot',
          executionMode: 'navigate'
        }
      ]
    });
  }

  return items;
};
