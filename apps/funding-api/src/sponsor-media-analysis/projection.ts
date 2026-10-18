import type { Pool, PoolClient } from 'pg';

import {
  isSponsorMediaAnalysisDraft,
  validateSponsorMediaAnalysisSuggestion,
  type SponsorMediaAnalysisCapabilities,
  type SponsorMediaAnalysisDraft,
  type SponsorMediaAnalysisReceipt,
  type SponsorMediaAnalysisResponse,
  type SponsorMediaAnalysisReview,
  type SponsorMediaAnalysisRun
} from '../../../../packages/funding-core/src/index.js';
import { isValidUuid } from '../business-helpers/request-validation.js';

import { requireAnalysis, type MediaAnalysisRow } from './shared.js';

interface ProjectionRow extends MediaAnalysisRow {
  stale: boolean;
  snapshot: unknown | null;
  review_version: number | null;
  review_decision: SponsorMediaAnalysisReview['decision'] | null;
  draft: SponsorMediaAnalysisDraft | null;
  actor: string | null;
  reviewed_at: string | null;
}
export async function projectAnalysis(
  db: Pick<PoolClient, 'query'>,
  contributionId: string,
  capabilities: SponsorMediaAnalysisCapabilities
): Promise<SponsorMediaAnalysisResponse> {
  const result = await db.query<ProjectionRow>(
    `SELECT DISTINCT ON (r.asset_id) r.*,r.created_at::text AS created_at,r.finished_at::text AS finished_at,
      (a.deleted_at IS NOT NULL OR a.checksum_sha256<>r.checksum) AS stale,s.snapshot,
      v.version AS review_version,v.decision AS review_decision,v.draft,v.actor,v.created_at::text AS reviewed_at
      FROM sponsor_media_analysis_runs r JOIN sponsor_media_assets a ON a.id=r.asset_id
      LEFT JOIN sponsor_media_analysis_suggestions s ON s.run_id=r.id
      LEFT JOIN LATERAL (SELECT version,decision,draft,actor,created_at FROM sponsor_media_analysis_reviews WHERE run_id=r.id ORDER BY version DESC LIMIT 1) v ON true
      WHERE r.contribution_id=$1::uuid AND a.deleted_at IS NULL ORDER BY r.asset_id,r.created_at DESC,r.id DESC LIMIT 101`,
    [contributionId]
  );
  const runs: SponsorMediaAnalysisRun[] = result.rows.map((row) => {
    const suggestion = row.snapshot;
    requireAnalysis(
      suggestion === null ||
        validateSponsorMediaAnalysisSuggestion(
          suggestion,
          row.checksum,
          row.adapter_version
        ),
      'MEDIA_ANALYSIS_SUGGESTION_INVALID',
      503
    );
    requireAnalysis(
      row.draft === null || isSponsorMediaAnalysisDraft(row.draft),
      'MEDIA_ANALYSIS_REVIEW_INVALID',
      503
    );
    return {
      id: row.id,
      assetId: row.asset_id,
      checksum: row.checksum,
      adapterVersion: row.adapter_version,
      state: row.state,
      stale: row.stale,
      errorCode: row.error_code,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      suggestion,
      review:
        row.review_version === null
          ? null
          : {
              version: row.review_version,
              decision: row.review_decision!,
              draft: row.draft!,
              actor: row.actor!,
              createdAt: row.reviewed_at!
            }
    };
  });
  return { contributionId, capabilities, runs };
}
export async function readAnalysisReceipt(
  pool: Pick<Pool, 'query'>,
  contributionId: string,
  requestId: string,
  actor: string
): Promise<SponsorMediaAnalysisReceipt> {
  requireAnalysis(
    isValidUuid(contributionId) && isValidUuid(requestId),
    'MEDIA_ANALYSIS_INVALID',
    400
  );
  const row = (
    await pool.query<{
      actor: string;
      action: 'run' | 'review';
      result_id: string;
    }>(
      'SELECT actor,action,result_id FROM sponsor_media_analysis_requests WHERE contribution_id=$1::uuid AND request_id=$2::uuid',
      [contributionId, requestId]
    )
  ).rows[0];
  if (!row) return { found: false };
  requireAnalysis(row.actor === actor, 'MEDIA_ANALYSIS_RECEIPT_FORBIDDEN', 403);
  return { found: true, action: row.action, resultId: row.result_id };
}
