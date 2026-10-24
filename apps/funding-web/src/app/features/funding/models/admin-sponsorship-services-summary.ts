import type {
  AdminSponsorshipProgress,
  SponsorshipFulfilmentEvidence,
  SponsorshipObligation,
  SponsorshipPublicationWorkflowObligation,
  SponsorshipPublicationWorkflowState
} from '@openg7/funding-core';

import { qualifiedPublicationEvidence } from './admin-sponsorship-workspace.js';

export type DossierServiceSummaryState =
  'ready' | 'agreement_unknown' | 'agreement_unconfirmed' | 'empty';

export type DossierServiceStatus =
  | 'fulfilled'
  | 'adjusted'
  | 'unverified'
  | 'unavailable'
  | Exclude<SponsorshipPublicationWorkflowState, 'complete'>;

export interface DossierServiceSummaryRow {
  readonly obligation: SponsorshipObligation;
  readonly workflow: SponsorshipPublicationWorkflowObligation | null;
  readonly evidence: SponsorshipFulfilmentEvidence | undefined;
  readonly status: DossierServiceStatus;
  readonly occurrenceCount: number;
}

export interface DossierServiceSummary {
  readonly state: DossierServiceSummaryState;
  readonly total: number;
  readonly fulfilled: number;
  readonly adjusted: number;
  readonly remaining: number;
  readonly rows: readonly DossierServiceSummaryRow[];
}

/** Read-only presentation of recorded promises and their qualified server facts. */
export function dossierServiceSummary(
  dossier: AdminSponsorshipProgress
): DossierServiceSummary {
  const commitment = dossier.commitment;
  if (!commitment || commitment.state !== 'active' || !commitment.offer)
    return {
      state:
        commitment && commitment.state !== 'active'
          ? 'agreement_unconfirmed'
          : 'agreement_unknown',
      total: 0,
      fulfilled: 0,
      adjusted: 0,
      remaining: 0,
      rows: []
    };

  const occurrences = new Map<string, number>();
  for (const obligation of commitment.obligations)
    occurrences.set(
      obligation.benefitId,
      (occurrences.get(obligation.benefitId) ?? 0) + 1
    );

  const rows = commitment.obligations.map<DossierServiceSummaryRow>(
    (obligation) => {
      const workflow =
        dossier.publicationWorkflow?.obligations.find(
          (item) =>
            item.obligationId === obligation.id &&
            item.channel === obligation.channel &&
            item.target === obligation.target &&
            item.ordinal === obligation.ordinal
        ) ?? null;
      const evidence = qualifiedPublicationEvidence(dossier, obligation.id);
      const status: DossierServiceStatus = evidence
        ? 'fulfilled'
        : obligation.state === 'adjusted'
          ? 'adjusted'
          : obligation.state === 'fulfilled' || workflow?.state === 'complete'
            ? 'unverified'
            : (workflow?.state ?? 'unavailable');
      return {
        obligation,
        workflow,
        evidence,
        status,
        occurrenceCount: occurrences.get(obligation.benefitId) ?? 1
      };
    }
  );
  const fulfilled = rows.filter((row) => row.status === 'fulfilled').length;
  const adjusted = rows.filter((row) => row.status === 'adjusted').length;
  return {
    state: rows.length ? 'ready' : 'empty',
    total: rows.length,
    fulfilled,
    adjusted,
    remaining: rows.length - fulfilled - adjusted,
    rows
  };
}
