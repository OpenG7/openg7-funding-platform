import type { PoolClient } from 'pg';

import type { SponsorMediaAnalysisRequest } from '../../../../packages/funding-core/src/index.js';

import { mediaAnalysisAudit, requireAnalysis } from './shared.js';

/** Creates a source-versioned run inside the caller's command transaction. */
export async function startAnalysisRun(
  db: PoolClient,
  input: SponsorMediaAnalysisRequest,
  actor: string,
  adapterVersion: string
): Promise<string> {
  const asset = (
    await db.query<{ checksum_sha256: string; version: string }>(
      'SELECT checksum_sha256,updated_at::text AS version FROM sponsor_media_assets WHERE id=$1::uuid AND contribution_id=$2::uuid AND deleted_at IS NULL FOR UPDATE',
      [input.assetId, input.contributionId]
    )
  ).rows[0];
  requireAnalysis(asset, 'MEDIA_ANALYSIS_ASSET_NOT_FOUND', 404);
  requireAnalysis(asset.version === input.expectedVersion, 'VERSION_CONFLICT');
  const active = (
    await db.query<{ id: string }>(
      `SELECT id FROM sponsor_media_analysis_runs WHERE asset_id=$1::uuid AND checksum=$2 AND adapter_version=$3 AND state IN ('queued','processing') LIMIT 1`,
      [input.assetId, asset.checksum_sha256, adapterVersion]
    )
  ).rows[0];
  if (active) return active.id;
  const prior = (
    await db.query<{ id: string; generation: number }>(
      'SELECT id,generation FROM sponsor_media_analysis_runs WHERE asset_id=$1::uuid AND checksum=$2 AND adapter_version=$3 ORDER BY generation DESC LIMIT 1',
      [input.assetId, asset.checksum_sha256, adapterVersion]
    )
  ).rows[0];
  if (prior && !input.rerun) return prior.id;
  // Dossier lock serializes quota checks while assets remain independently versioned.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'media-analysis-quota:' + input.contributionId
  ]);
  const budget = (
    await db.query<{ active: number; daily: number }>(
      `SELECT count(*) FILTER (WHERE state IN ('queued','processing'))::int AS active,count(*) FILTER (WHERE created_at>clock_timestamp()-INTERVAL '1 day')::int AS daily FROM sponsor_media_analysis_runs WHERE contribution_id=$1::uuid`,
      [input.contributionId]
    )
  ).rows[0];
  requireAnalysis(
    budget.active < 100 && budget.daily < 1000,
    'MEDIA_ANALYSIS_BUDGET_EXCEEDED',
    429
  );
  const cancelled = await db.query<{ id: string }>(
    `UPDATE sponsor_media_analysis_runs SET state='cancelled',finished_at=clock_timestamp(),claim_token=NULL,lease_expires_at=NULL,error_code='MEDIA_ANALYSIS_STALE' WHERE asset_id=$1::uuid AND checksum<>$2 AND state IN ('queued','processing') RETURNING id`,
    [input.assetId, asset.checksum_sha256]
  );
  for (const old of cancelled.rows)
    await mediaAnalysisAudit(
      db,
      actor,
      input.contributionId,
      input.assetId,
      'cancelled',
      { runId: old.id, code: 'MEDIA_ANALYSIS_STALE' }
    );
  const run = (
    await db.query<{ id: string }>(
      'INSERT INTO sponsor_media_analysis_runs(contribution_id,asset_id,checksum,adapter_version,generation,requested_by) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6) RETURNING id',
      [
        input.contributionId,
        input.assetId,
        asset.checksum_sha256,
        adapterVersion,
        (prior?.generation ?? 0) + 1,
        actor
      ]
    )
  ).rows[0]!;
  await mediaAnalysisAudit(
    db,
    actor,
    input.contributionId,
    input.assetId,
    'requested',
    {
      requestId: input.requestId,
      runId: run.id,
      adapterVersion: adapterVersion,
      rerun: input.rerun
    }
  );
  return run.id;
}
