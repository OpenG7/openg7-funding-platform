// Deterministic admin attention service for the read-only AI assistant.
//
// This module is intentionally independent of any AI model: it composes the
// existing application repositories and turns their data into a prioritised,
// GLOBAL work queue of `AdminAttentionItem`s plus an `AdminAssistantSummary`.
// The AI layer (tools, provider, orchestrator) only ever reads what this
// service produces — it never decides a status, an amount or a permission.
//
// Privacy: items only carry minimal, non-sensitive facts. Company names,
// contact emails, follow-up tokens and provider secrets never appear here.

import type { AdminAssistantSummary } from '@openg7/funding-core';
import type { Pool } from 'pg';

import { resolveSponsorshipSocialChannels } from '../sponsorship-benefits.js';

import type { BuildAdminAssistantSummaryOptions } from './attention/contracts.js';
import { loadAttentionDataset } from './attention/dataset.js';
import { DEFAULT_MAX_ATTENTION_ITEMS } from './attention/shared.js';
import { buildSummaryFromDataset } from './attention/summary.js';

export type {
  AttentionDataset,
  FinancialTotalsInput,
  BuildAdminAssistantSummaryOptions
} from './attention/contracts.js';
export { DEFAULT_MAX_ATTENTION_ITEMS } from './attention/shared.js';
export { buildAttentionItems } from './attention/compose.js';
export {
  detectSponsorshipInfoItems,
  detectSponsorshipReviewItems
} from './attention/sponsorship.detectors.js';
export {
  detectPublicationPreparationItems,
  detectLatePublicationItems
} from './attention/publication.detectors.js';
export { detectFailedEmailItems } from './attention/email.detectors.js';
export { detectFinancialWarningItems } from './attention/financial.detectors.js';
export {
  buildFinancialSummary,
  buildSummaryFromDataset
} from './attention/summary.js';
export { loadAttentionDataset } from './attention/dataset.js';

export {
  hasCompleteFiche,
  isActionableSponsorship,
  missingFicheFields
} from '../sponsorship-review-policy.js';

export {
  sponsorshipAdminUrl,
  sponsorshipRef
} from '../sponsorship-admin-presentation.js';

export { activeDraftChannels } from '../sponsorship-publication-coverage.js';

export const promisedSocialChannels = resolveSponsorshipSocialChannels;

export const buildAdminAssistantSummary = async (
  pool: Pool | null,
  options: BuildAdminAssistantSummaryOptions = {}
): Promise<AdminAssistantSummary> => {
  const now = options.now ?? new Date();
  const dataset = await loadAttentionDataset(pool, now);
  return buildSummaryFromDataset(
    dataset,
    options.maxAttentionItems ?? DEFAULT_MAX_ATTENTION_ITEMS
  );
};
