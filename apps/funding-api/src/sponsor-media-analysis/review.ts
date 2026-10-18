import type { PoolClient } from 'pg';

import type { SponsorMediaAnalysisReviewRequest } from '../../../../packages/funding-core/src/index.js';
import { lockModerationDependencies } from '../moderation/content.js';
import { updateSponsorMediaMetadata } from '../sponsor-media/persistence-write.js';

import {
  mediaAnalysisAudit,
  requireAnalysis,
  type MediaAnalysisRow
} from './shared.js';

/** Records the human draft decision without granting rights or editorial approval. */
export async function reviewAnalysisRun(
  db: PoolClient,
  input: SponsorMediaAnalysisReviewRequest,
  actor: string
): Promise<string> {
  const reference = (
    await db.query<MediaAnalysisRow>(
      'SELECT * FROM sponsor_media_analysis_runs WHERE id=$1::uuid AND contribution_id=$2::uuid',
      [input.runId, input.contributionId]
    )
  ).rows[0];
  requireAnalysis(reference, 'MEDIA_ANALYSIS_RUN_NOT_FOUND', 404);
  requireAnalysis(
    reference.asset_id === input.confirmation,
    'CONFIRMATION_REQUIRED',
    400
  );
  await lockModerationDependencies(db, {
    type: 'media',
    id: reference.asset_id
  });
  const asset = (
    await db.query<{ checksum_sha256: string; version: string }>(
      'SELECT checksum_sha256,updated_at::text AS version FROM sponsor_media_assets WHERE id=$1::uuid AND contribution_id=$2::uuid AND deleted_at IS NULL FOR UPDATE',
      [reference.asset_id, input.contributionId]
    )
  ).rows[0];
  requireAnalysis(
    asset && asset.checksum_sha256 === reference.checksum,
    'MEDIA_ANALYSIS_STALE'
  );
  requireAnalysis(asset.version === input.expectedVersion, 'VERSION_CONFLICT');
  const run = (
    await db.query<MediaAnalysisRow>(
      'SELECT * FROM sponsor_media_analysis_runs WHERE id=$1::uuid FOR UPDATE',
      [input.runId]
    )
  ).rows[0]!;
  requireAnalysis(run.state === 'succeeded', 'MEDIA_ANALYSIS_NOT_READY');
  const latest = (
    await db.query<{ id: string }>(
      'SELECT id FROM sponsor_media_analysis_runs WHERE asset_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT 1',
      [run.asset_id]
    )
  ).rows[0];
  requireAnalysis(latest?.id === run.id, 'MEDIA_ANALYSIS_STALE');
  const current = (
    await db.query<{ version: number; decision: string }>(
      'SELECT version,decision FROM sponsor_media_analysis_reviews WHERE run_id=$1::uuid ORDER BY version DESC LIMIT 1',
      [run.id]
    )
  ).rows[0];
  requireAnalysis(
    (current?.version ?? 0) === input.expectedReviewVersion,
    'MEDIA_ANALYSIS_REVIEW_VERSION_CONFLICT'
  );
  requireAnalysis(
    !current || current.decision === 'saved',
    'MEDIA_ANALYSIS_REVIEW_TERMINAL'
  );
  if (input.decision === 'accept') {
    const changed = await updateSponsorMediaMetadata(db, {
      assetId: run.asset_id,
      expectedVersion: input.expectedVersion,
      confirmation: input.confirmation,
      altText: input.draft.altText,
      actor
    });
    requireAnalysis(changed.status === 'updated', 'VERSION_CONFLICT');
  }
  const decision =
    input.decision === 'save'
      ? 'saved'
      : input.decision === 'reject'
        ? 'rejected'
        : 'accepted';
  const review = (
    await db.query<{ id: string }>(
      'INSERT INTO sponsor_media_analysis_reviews(contribution_id,run_id,version,decision,draft,actor,request_id) VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7::uuid) RETURNING id',
      [
        input.contributionId,
        run.id,
        (current?.version ?? 0) + 1,
        decision,
        JSON.stringify(input.draft),
        actor,
        input.requestId
      ]
    )
  ).rows[0]!;
  await mediaAnalysisAudit(
    db,
    actor,
    input.contributionId,
    run.asset_id,
    decision,
    {
      requestId: input.requestId,
      runId: run.id,
      reviewVersion: (current?.version ?? 0) + 1
    }
  );
  return review.id;
}
