import type { PreparationAssistanceSummary } from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { requireAssistance } from './errors.js';
import { assistanceDigest } from './persistence.js';
import { assistanceCapabilities, assistanceIsStale } from './projection.js';

interface SummaryRow {
  readonly contribution_id: string;
  readonly commitment_version: number;
  readonly commitment_state: 'needs_confirmation' | 'active';
  readonly source_version: number | null;
  readonly run_id: string | null;
  readonly run_source_version: number;
  readonly run_commitment_version: number;
  readonly adapter: NonNullable<PreparationAssistanceSummary['run']>['adapter'];
  readonly state: NonNullable<PreparationAssistanceSummary['run']>['state'];
  readonly phase: NonNullable<PreparationAssistanceSummary['run']>['phase'];
  readonly error_code: string | null;
  readonly review_version: number;
  readonly review_decision: NonNullable<
    PreparationAssistanceSummary['run']
  >['reviewDecision'];
  readonly applied_commitment_version: number | null;
  readonly clause_count: number;
  readonly unsupported_count: number;
  readonly unresolved_count: number;
}

/** Scalar-only projection: no agreement, citation, draft, actor or offer body crosses this query. */
export async function projectAssistanceSummary(
  db: PoolClient,
  contributionId: string
): Promise<PreparationAssistanceSummary> {
  const row = (
    await db.query<SummaryRow>(
      `SELECT c.id AS contribution_id,m.version AS commitment_version,m.state AS commitment_state,
         source.version AS source_version,run.id AS run_id,run.source_version AS run_source_version,
         run.commitment_version AS run_commitment_version,run.adapter,run.state,run.phase,run.error_code,
         COALESCE(review.version,0) AS review_version,review.decision AS review_decision,
         review.applied_commitment_version,COALESCE(suggestion.clause_count,0) AS clause_count,
         COALESCE(suggestion.unsupported_count,0) AS unsupported_count,
         COALESCE(review.unresolved_count,suggestion.clause_count,0) AS unresolved_count
       FROM fund_contributions c JOIN sponsorship_commitments m ON m.contribution_id=c.id
       LEFT JOIN LATERAL (SELECT version FROM preparation_assistance_sources
         WHERE contribution_id=c.id ORDER BY version DESC LIMIT 1) source ON true
       LEFT JOIN LATERAL (SELECT id,source_version,commitment_version,adapter,state,phase,error_code
         FROM preparation_assistance_runs WHERE contribution_id=c.id
         ORDER BY created_at DESC,id DESC LIMIT 1) run ON true
       LEFT JOIN LATERAL (SELECT jsonb_array_length(snapshot->'items') AS clause_count,
         (SELECT count(*)::int FROM jsonb_array_elements(snapshot->'items') item
          WHERE item->>'attention'='unsupported_terms') AS unsupported_count
         FROM preparation_assistance_suggestions WHERE run_id=run.id) suggestion ON true
       LEFT JOIN LATERAL (SELECT version,decision,applied_commitment_version,
         (SELECT count(*)::int FROM jsonb_array_elements(draft->'items') item
          WHERE COALESCE(item->>'disposition','unresolved') NOT IN ('included','excluded')) AS unresolved_count
         FROM preparation_assistance_reviews WHERE run_id=run.id
         ORDER BY version DESC LIMIT 1) review ON true
       WHERE c.id=$1::uuid AND c.contribution_type='sponsorship_interest'
         AND c.status IN ('paid','refunded','disputed')`,
      [contributionId]
    )
  ).rows[0];
  requireAssistance(row, 'ASSISTANCE_NOT_FOUND', 404);
  const run: PreparationAssistanceSummary['run'] = row.run_id
    ? {
        id: row.run_id,
        sourceVersion: row.run_source_version,
        commitmentVersion: row.run_commitment_version,
        adapter: row.adapter,
        state: row.state,
        phase: row.phase,
        errorCode: row.error_code,
        reviewVersion: row.review_version,
        reviewDecision: row.review_decision,
        clauseCount: row.clause_count,
        unsupportedCount: row.unsupported_count,
        unresolvedCount: row.unresolved_count,
        appliedCommitmentVersion: row.applied_commitment_version
      }
    : null;
  const stale = assistanceIsStale(
    row.source_version,
    row.commitment_version,
    run
  );
  const summary = {
    contributionId: row.contribution_id,
    controlCode: 'accepted_offer' as const,
    sourceVersion: row.source_version,
    commitmentVersion: row.commitment_version,
    run,
    stale,
    capabilities: assistanceCapabilities(
      row.source_version !== null,
      row.commitment_state === 'needs_confirmation',
      stale,
      run?.state ?? null,
      run?.reviewDecision ?? null
    )
  };
  return { ...summary, revision: assistanceDigest(summary) };
}
