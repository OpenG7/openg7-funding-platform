import type {
  ResponsibilityBalanceEvidence,
  SponsorshipCommitmentRecord,
  SponsorshipObligation
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { dossierFulfilmentQualificationSql } from './sponsorship-commitments/historical-audit-projection.js';

/** Internal qualification facts only; no source/media snapshot leaves this repository. */
export interface SponsorshipEvidenceFact extends ResponsibilityBalanceEvidence {
  readonly mode: string;
  readonly qualifiedSnapshot: boolean;
}

export const exactSponsorshipEvidence = (
  obligation: SponsorshipObligation,
  evidence: SponsorshipEvidenceFact
): boolean =>
  evidence.id === obligation.fulfilmentEvidenceId &&
  evidence.obligationId === obligation.id &&
  evidence.contributionId === obligation.contributionId &&
  evidence.channel === obligation.channel &&
  evidence.target === obligation.target &&
  evidence.obligationVersion + 1 === obligation.version &&
  evidence.mode === 'live' &&
  Number.isFinite(Date.parse(evidence.deliveredAt)) &&
  (obligation.channel === 'website'
    ? evidence.provenance === 'website_verified'
    : ['provider_acknowledged', 'provider_verified'].includes(
        evidence.provenance
      ));

export function qualifiedSponsorshipEvidenceIds(
  commitment: SponsorshipCommitmentRecord | null | undefined,
  evidence: readonly SponsorshipEvidenceFact[]
): readonly string[] {
  return (commitment?.obligations ?? []).flatMap((obligation) => {
    const benefit = commitment?.offer?.benefits.find(
      (item) => item.id === obligation.benefitId
    );
    const match = evidence.find((item) =>
      exactSponsorshipEvidence(obligation, item)
    );
    return obligation.state === 'fulfilled' &&
      benefit &&
      match?.qualifiedSnapshot &&
      (benefit.durationDays === null ||
        obligation.timing?.durationState === 'attested')
      ? [match.id]
      : [];
  });
}

export const hasQualifiedSponsorshipFulfilment = (
  obligation: SponsorshipObligation,
  qualifiedEvidenceIds: readonly string[]
): boolean =>
  obligation.state === 'fulfilled' &&
  obligation.fulfilmentEvidenceId !== null &&
  qualifiedEvidenceIds.includes(obligation.fulfilmentEvidenceId);

export async function loadSponsorshipEvidenceFacts(
  client: Pool | PoolClient,
  contributionId: string,
  evaluatedAt: string | null = null
): Promise<readonly SponsorshipEvidenceFact[]> {
  const result = await client.query<SponsorshipEvidenceFact>(
    `${dossierFulfilmentQualificationSql.replaceAll('$1::timestamptz', 'COALESCE($1::timestamptz,transaction_timestamp())')}
    SELECT proof.id,proof.obligation_id AS "obligationId",proof.contribution_id AS "contributionId",
      proof.obligation_version AS "obligationVersion",proof.channel,proof.target,proof.mode,proof.provenance,
      proof.delivered_at::text AS "deliveredAt",proof.external_post_url AS "externalPostUrl",
      COALESCE(cardinality(classified.findings)=0,FALSE) AS "qualifiedSnapshot"
    FROM sponsorship_fulfilment_evidence proof LEFT JOIN classified ON classified.id=proof.id
    WHERE proof.contribution_id=$2::uuid ORDER BY proof.obligation_id,proof.id`,
    [evaluatedAt, contributionId]
  );
  return result.rows;
}
