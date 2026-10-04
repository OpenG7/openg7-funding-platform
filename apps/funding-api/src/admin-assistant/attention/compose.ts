import type { AdminAttentionItem } from '@openg7/funding-core';

import type { AttentionDataset } from './contracts.js';
import { SEVERITY_RANK } from './shared.js';
import {
  detectSponsorshipInfoItems,
  detectSponsorshipReviewItems
} from './sponsorship.detectors.js';
import {
  detectPublicationPreparationItems,
  detectLatePublicationItems
} from './publication.detectors.js';
import { detectFailedEmailItems } from './email.detectors.js';
import { detectFinancialWarningItems } from './financial.detectors.js';

const sortAttentionItems = (
  items: readonly AdminAttentionItem[]
): AdminAttentionItem[] =>
  [...items].sort((first, second) => {
    const bySeverity =
      SEVERITY_RANK[first.severity] - SEVERITY_RANK[second.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const firstDue = first.dueAt ?? first.detectedAt;
    const secondDue = second.dueAt ?? second.detectedAt;
    return firstDue.localeCompare(secondDue);
  });

export const buildAttentionItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  sortAttentionItems([
    ...detectSponsorshipInfoItems(dataset),
    ...detectSponsorshipReviewItems(dataset),
    ...detectPublicationPreparationItems(dataset),
    ...detectLatePublicationItems(dataset),
    ...detectFailedEmailItems(dataset),
    ...detectFinancialWarningItems(dataset)
  ]);
