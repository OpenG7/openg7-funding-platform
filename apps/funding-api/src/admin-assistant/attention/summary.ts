import type {
  AdminAssistantFinancialSummary,
  AdminAssistantSummary,
  AdminAttentionItem
} from '@openg7/funding-core';

import { isApprovedActionableSponsorship } from '../../sponsorship-review-policy.js';

import { buildAttentionItems } from './compose.js';
import type { AttentionDataset } from './contracts.js';
import { DEFAULT_MAX_ATTENTION_ITEMS } from './shared.js';

export const buildFinancialSummary = (
  dataset: AttentionDataset
): AdminAssistantFinancialSummary => {
  const { financialTotals, sponsorshipsTruncated } = dataset;
  const limitations = [
    'Les frais de traitement Stripe ne sont pas inclus dans ce résumé.',
    'Le montant net réel dépend des frais et des remboursements confirmés par Stripe.'
  ];
  if (financialTotals.disputed > 0) {
    limitations.push(
      'Des paiements en litige (disputed) peuvent réduire le montant net.'
    );
  }
  if (sponsorshipsTruncated) {
    limitations.push(
      "Le nombre de commandites dépasse la limite d'analyse; certaines peuvent être omises."
    );
  }

  return {
    grossPaid: financialTotals.grossPaid,
    processingFees: null,
    refunded: financialTotals.refunded,
    netReceived: null,
    currency: financialTotals.currency,
    limitations
  };
};

/** Counters cover the full detected set before the response item cap. */
export const buildSummaryFromDataset = (
  dataset: AttentionDataset,
  maxAttentionItems: number = DEFAULT_MAX_ATTENTION_ITEMS
): AdminAssistantSummary => {
  const items = buildAttentionItems(dataset);

  const countByType = (type: AdminAttentionItem['type']): number =>
    items.filter((item) => item.type === type).length;

  const approvedSponsorships = dataset.sponsorships.filter(
    isApprovedActionableSponsorship
  ).length;

  const scheduledPublications =
    dataset.slots.filter((slot) => slot.status === 'scheduled').length +
    dataset.batches.filter((batch) => batch.status === 'scheduled').length;

  const failedEmails = dataset.emailMessages.filter(
    (message) => message.status === 'failed'
  ).length;

  return {
    generatedAt: dataset.now.toISOString(),
    counts: {
      urgent: items.filter((item) => item.severity === 'urgent').length,
      today: items.filter((item) => item.severity === 'today').length,
      thisWeek: items.filter((item) => item.severity === 'this_week').length,
      informational: items.filter((item) => item.severity === 'informational')
        .length
    },
    sponsorships: {
      needsInfo: countByType('sponsorship_needs_info'),
      needsReview: countByType('sponsorship_needs_review'),
      approved: approvedSponsorships
    },
    publications: {
      needsPreparation: countByType('publication_needs_preparation'),
      scheduled: scheduledPublications,
      late: countByType('publication_late')
    },
    emails: {
      failed: failedEmails
    },
    financialSummary: buildFinancialSummary(dataset),
    attentionItems: items.slice(0, Math.max(0, maxAttentionItems))
  };
};
