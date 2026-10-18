import type { Pool, PoolClient } from 'pg';

import {
  isSponsorMediaAnalysisDraft,
  type SponsorMediaAnalysisCapabilities,
  type SponsorMediaAnalysisDraft,
  type SponsorMediaAnalysisRequest,
  type SponsorMediaAnalysisResponse,
  type SponsorMediaAnalysisReviewRequest
} from '../../../../packages/funding-core/src/index.js';
import { isValidUuid } from '../business-helpers/request-validation.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import { projectAnalysis } from './projection.js';
import {
  analysisHash,
  requireAnalysis,
  SponsorMediaAnalysisError
} from './shared.js';

const asCommand = (
  raw: unknown,
  keys: readonly string[]
): Record<string, unknown> => {
  requireAnalysis(
    raw && typeof raw === 'object' && !Array.isArray(raw),
    'MEDIA_ANALYSIS_INVALID',
    400
  );
  const input = raw as Record<string, unknown>;
  requireAnalysis(
    Object.keys(input).length === keys.length &&
      Object.keys(input).every((key) => keys.includes(key)),
    'MEDIA_ANALYSIS_INVALID',
    400
  );
  requireAnalysis(
    isValidUuid(input.requestId) && isValidUuid(input.contributionId),
    'MEDIA_ANALYSIS_INVALID',
    400
  );
  return {
    ...Object.fromEntries(keys.map((key) => [key, input[key]])),
    requestId: String(input.requestId).toLowerCase(),
    contributionId: String(input.contributionId).toLowerCase()
  };
};
const validVersion = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100;

export function parseAnalysisStart(raw: unknown): SponsorMediaAnalysisRequest {
  const parsed = asCommand(raw, [
    'requestId',
    'contributionId',
    'assetId',
    'expectedVersion',
    'rerun'
  ]);
  requireAnalysis(
    isValidUuid(parsed.assetId) &&
      validVersion(parsed.expectedVersion) &&
      typeof parsed.rerun === 'boolean',
    'MEDIA_ANALYSIS_INVALID',
    400
  );
  const input = {
    ...parsed,
    assetId: String(parsed.assetId).toLowerCase()
  } as unknown as SponsorMediaAnalysisRequest;
  return input;
}
export function parseAnalysisReview(
  raw: unknown
): SponsorMediaAnalysisReviewRequest {
  const parsed = asCommand(raw, [
    'requestId',
    'contributionId',
    'runId',
    'expectedVersion',
    'expectedReviewVersion',
    'decision',
    'confirmation',
    'draft'
  ]);
  requireAnalysis(
    isValidUuid(parsed.runId) &&
      isValidUuid(parsed.confirmation) &&
      validVersion(parsed.expectedVersion) &&
      Number.isSafeInteger(parsed.expectedReviewVersion) &&
      Number(parsed.expectedReviewVersion) >= 0 &&
      ['save', 'reject', 'accept'].includes(String(parsed.decision)) &&
      isSponsorMediaAnalysisDraft(parsed.draft),
    'MEDIA_ANALYSIS_INVALID',
    400
  );
  const input = {
    ...parsed,
    runId: String(parsed.runId).toLowerCase(),
    confirmation: String(parsed.confirmation).toLowerCase(),
    draft: {
      altText:
        (parsed.draft as SponsorMediaAnalysisDraft).altText?.trim() || null,
      classification: (parsed.draft as SponsorMediaAnalysisDraft).classification
    }
  } as unknown as SponsorMediaAnalysisReviewRequest;
  return input;
}
async function recordedAnalysisRequest(
  db: Pick<PoolClient, 'query'>,
  requestId: string,
  actor: string,
  hash: string
): Promise<boolean> {
  const row = (
    await db.query<{ actor: string; request_hash: string }>(
      'SELECT actor,request_hash FROM sponsor_media_analysis_requests WHERE request_id=$1::uuid',
      [requestId]
    )
  ).rows[0];
  if (!row) return false;
  requireAnalysis(
    row.actor === actor && row.request_hash === hash,
    'MEDIA_ANALYSIS_REQUEST_CONFLICT'
  );
  return true;
}
export async function executeAnalysisCommand(
  pool: Pool,
  capabilities: SponsorMediaAnalysisCapabilities,
  input: { requestId: string; contributionId: string },
  action: 'run' | 'review',
  actor: string,
  execute: (db: PoolClient) => Promise<string>
): Promise<SponsorMediaAnalysisResponse> {
  requireAnalysis(
    typeof actor === 'string' && actor.trim().length > 0 && actor.length <= 200,
    'MEDIA_ANALYSIS_INVALID',
    400
  );
  const hash = analysisHash({ input, action, actor });
  try {
    return await withPostgresTransaction(
      pool,
      async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'media-analysis:' + input.requestId
        ]);
        if (
          !(await recordedAnalysisRequest(db, input.requestId, actor, hash))
        ) {
          const resultId = await execute(db);
          await db.query(
            'INSERT INTO sponsor_media_analysis_requests(request_id,contribution_id,action,actor,request_hash,result_id) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid)',
            [
              input.requestId,
              input.contributionId,
              action,
              actor,
              hash,
              resultId
            ]
          );
        }
        return projectAnalysis(db, input.contributionId, capabilities);
      },
      { preserveOriginalError: true }
    );
  } catch (error) {
    if (error instanceof SponsorMediaAnalysisError) throw error;
    // Reconcile a possibly successful COMMIT without re-executing the mutation.
    try {
      const recovered = await withPostgresTransaction(
        pool,
        async (db) =>
          (await recordedAnalysisRequest(db, input.requestId, actor, hash))
            ? projectAnalysis(db, input.contributionId, capabilities)
            : null,
        { readOnlySnapshot: true }
      );
      if (recovered) return recovered;
    } catch (recoveryError) {
      if (
        recoveryError instanceof SponsorMediaAnalysisError &&
        recoveryError.code === 'MEDIA_ANALYSIS_REQUEST_CONFLICT'
      )
        throw recoveryError;
    }
    throw new SponsorMediaAnalysisError('MEDIA_ANALYSIS_UNAVAILABLE', 503);
  }
}
