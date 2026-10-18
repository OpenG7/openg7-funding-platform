import type { Pool, PoolClient } from 'pg';

import {
  isSponsorMediaAnalysisDraft,
  validateSponsorMediaAnalysisSuggestion,
  type SponsorMediaAnalysisDraft,
  type SponsorMediaAnalysisReceipt,
  type SponsorMediaAnalysisResponse,
  type SponsorMediaAnalysisReview,
  type SponsorMediaAnalysisRequest,
  type SponsorMediaAnalysisReviewRequest,
  type SponsorMediaAnalysisRun
} from '../../../../packages/funding-core/src/index.js';
import { isValidUuid } from '../business-helpers/request-validation.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import { lockModerationDependencies } from '../moderation/content.js';
import { updateSponsorMediaMetadata } from '../sponsor-media/persistence-write.js';
import type { SponsorMediaStorage } from '../sponsor-media-storage.js';

import {
  analysisHash,
  mediaAnalysisAudit,
  requireAnalysis,
  SponsorMediaAnalysisError,
  type MediaAnalysisRow
} from './shared.js';
import {
  localTechnicalMediaAdapter,
  tickSponsorMediaAnalysis,
  type SponsorMediaAnalysisAdapter
} from './worker.js';

export { SponsorMediaAnalysisError } from './shared.js';
interface ProjectionRow extends MediaAnalysisRow {
  stale: boolean;
  snapshot: unknown | null;
  review_version: number | null;
  review_decision: SponsorMediaAnalysisReview['decision'] | null;
  draft: SponsorMediaAnalysisDraft | null;
  actor: string | null;
  reviewed_at: string | null;
}
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

/** Owns source-sensitive proposals and human edits; never grants rights or an N0 decision. */
export class SponsorMediaAnalysisService {
  private readonly adapter: SponsorMediaAnalysisAdapter;
  constructor(
    private readonly pool: Pool,
    private readonly storage: Pick<SponsorMediaStorage, 'readPrivateObject'>,
    options: { readonly adapter?: SponsorMediaAnalysisAdapter } = {}
  ) {
    this.adapter = options.adapter ?? localTechnicalMediaAdapter;
    requireAnalysis(
      /^[a-z][a-z0-9_]{0,99}$/.test(this.adapter.version),
      'MEDIA_ANALYSIS_ADAPTER_INVALID',
      400
    );
  }
  private async project(
    db: Pick<PoolClient, 'query'>,
    contributionId: string
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
    return { contributionId, capabilities: this.adapter.capabilities, runs };
  }
  async read(contributionId: string): Promise<SponsorMediaAnalysisResponse> {
    requireAnalysis(isValidUuid(contributionId), 'MEDIA_ANALYSIS_INVALID', 400);
    return withPostgresTransaction(
      this.pool,
      (db) => this.project(db, contributionId.toLowerCase()),
      { readOnlySnapshot: true }
    );
  }
  async receipt(
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
      await this.pool.query<{
        actor: string;
        action: 'run' | 'review';
        result_id: string;
      }>(
        'SELECT actor,action,result_id FROM sponsor_media_analysis_requests WHERE contribution_id=$1::uuid AND request_id=$2::uuid',
        [contributionId, requestId]
      )
    ).rows[0];
    if (!row) return { found: false };
    requireAnalysis(
      row.actor === actor,
      'MEDIA_ANALYSIS_RECEIPT_FORBIDDEN',
      403
    );
    return { found: true, action: row.action, resultId: row.result_id };
  }
  private async recorded(
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
  private async command(
    input: { requestId: string; contributionId: string },
    action: 'run' | 'review',
    actor: string,
    execute: (db: PoolClient) => Promise<string>
  ): Promise<SponsorMediaAnalysisResponse> {
    requireAnalysis(
      typeof actor === 'string' &&
        actor.trim().length > 0 &&
        actor.length <= 200,
      'MEDIA_ANALYSIS_INVALID',
      400
    );
    const hash = analysisHash({ input, action, actor });
    try {
      return await withPostgresTransaction(
        this.pool,
        async (db) => {
          await db.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            ['media-analysis:' + input.requestId]
          );
          if (!(await this.recorded(db, input.requestId, actor, hash))) {
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
          return this.project(db, input.contributionId);
        },
        { preserveOriginalError: true }
      );
    } catch (error) {
      if (error instanceof SponsorMediaAnalysisError) throw error;
      // Reconcile a possibly successful COMMIT without re-executing the mutation.
      try {
        const recovered = await withPostgresTransaction(
          this.pool,
          async (db) =>
            (await this.recorded(db, input.requestId, actor, hash))
              ? this.project(db, input.contributionId)
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
  start(raw: unknown, actor: string): Promise<SponsorMediaAnalysisResponse> {
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
    return this.command(input, 'run', actor, async (db) => {
      const asset = (
        await db.query<{ checksum_sha256: string; version: string }>(
          'SELECT checksum_sha256,updated_at::text AS version FROM sponsor_media_assets WHERE id=$1::uuid AND contribution_id=$2::uuid AND deleted_at IS NULL FOR UPDATE',
          [input.assetId, input.contributionId]
        )
      ).rows[0];
      requireAnalysis(asset, 'MEDIA_ANALYSIS_ASSET_NOT_FOUND', 404);
      requireAnalysis(
        asset.version === input.expectedVersion,
        'VERSION_CONFLICT'
      );
      const active = (
        await db.query<{ id: string }>(
          `SELECT id FROM sponsor_media_analysis_runs WHERE asset_id=$1::uuid AND checksum=$2 AND adapter_version=$3 AND state IN ('queued','processing') LIMIT 1`,
          [input.assetId, asset.checksum_sha256, this.adapter.version]
        )
      ).rows[0];
      if (active) return active.id;
      const prior = (
        await db.query<{ id: string; generation: number }>(
          'SELECT id,generation FROM sponsor_media_analysis_runs WHERE asset_id=$1::uuid AND checksum=$2 AND adapter_version=$3 ORDER BY generation DESC LIMIT 1',
          [input.assetId, asset.checksum_sha256, this.adapter.version]
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
            this.adapter.version,
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
          adapterVersion: this.adapter.version,
          rerun: input.rerun
        }
      );
      return run.id;
    });
  }
  review(raw: unknown, actor: string): Promise<SponsorMediaAnalysisResponse> {
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
        classification: (parsed.draft as SponsorMediaAnalysisDraft)
          .classification
      }
    } as unknown as SponsorMediaAnalysisReviewRequest;
    return this.command(input, 'review', actor, async (db) => {
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
      requireAnalysis(
        asset.version === input.expectedVersion,
        'VERSION_CONFLICT'
      );
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
    });
  }
  tick(): Promise<void> {
    return tickSponsorMediaAnalysis(this.pool, this.storage, this.adapter);
  }
}
