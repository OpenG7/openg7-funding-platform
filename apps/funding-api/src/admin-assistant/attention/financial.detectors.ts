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

  if (financialTotals.disputed > 0) {
    items.push({
      id: 'financial_data_warning:disputed',
      type: 'financial_data_warning',
      severity: 'today',
      title: 'Paiements en litige détectés',
      explanation:
        `Des paiements totalisant ${financialTotals.disputed} ` +
        `${financialTotals.currency} sont en litige (disputed). Le montant net ` +
        `réellement disponible pourrait être inférieur au montant brut affiché.`,
      detectedAt: dataset.now.toISOString(),
      adminUrl: ADMIN_URLS.transparency,
      facts: {
        disputedAmount: financialTotals.disputed,
        currency: financialTotals.currency
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
