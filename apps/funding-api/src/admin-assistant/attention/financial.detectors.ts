import type { AdminAttentionItem } from '@openg7/funding-core';

import { SPONSORSHIP_ADMIN_PATH } from '../../sponsorship-admin-presentation.js';

import type { AttentionDataset } from './contracts.js';
import { ADMIN_URLS } from './shared.js';

/** Conservative warnings from known totals and source truncation. */
export const detectFinancialWarningItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] => {
  const items: AdminAttentionItem[] = [];
  const { financialTotals } = dataset;
  const disputes = dataset.disputedTotals
    ? dataset.disputedTotals
        .filter((total) => total.amountMinor > 0)
        .map((total) => ({
          disputed: total.amountMinor / 100,
          currency: total.currency,
          amountMinor: total.amountMinor
        }))
    : financialTotals && financialTotals.disputed > 0
      ? [
          {
            disputed: financialTotals.disputed,
            currency: financialTotals.currency,
            amountMinor: undefined
          }
        ]
      : [];
  for (const dispute of disputes) {
    items.push({
      id:
        'financial_data_warning:disputed' +
        (disputes.length > 1 ? ':' + dispute.currency : ''),
      type: 'financial_data_warning',
      severity: 'today',
      title: 'Paiements en litige détectés',
      explanation:
        `Des paiements totalisant ${dispute.disputed} ` +
        `${dispute.currency} sont en litige (disputed). Le montant net ` +
        `réellement disponible pourrait être inférieur au montant brut affiché.`,
      detectedAt: dataset.now.toISOString(),
      adminUrl: ADMIN_URLS.transparency,
      facts: {
        disputedAmount: dispute.disputed,
        currency: dispute.currency,
        ...(dispute.amountMinor !== undefined
          ? { disputedAmountMinor: dispute.amountMinor }
          : {})
      },
      suggestedActions: [
        {
          actionType: 'open_transparency',
          label: 'Ouvrir la transparence financière',
          executionMode: 'navigate'
        }
      ]
    });
  }

  if (dataset.sponsorshipsTruncated) {
    items.push({
      id: 'financial_data_warning:truncated',
      type: 'financial_data_warning',
      severity: 'informational',
      title: 'Analyse des commandites partielle',
      explanation:
        `Le nombre de commandites dépasse la limite d'analyse de l'assistant. ` +
        `Certains dossiers peuvent ne pas apparaître dans cette file de travail.`,
      detectedAt: dataset.now.toISOString(),
      adminUrl: SPONSORSHIP_ADMIN_PATH,
      facts: { truncated: true },
      suggestedActions: []
    });
  }

  return items;
};
