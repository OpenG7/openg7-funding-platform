import { createHash, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import sharp from 'sharp';

import {
  SPONSOR_MEDIA_ANALYSIS_VERSION,
  validateSponsorMediaAnalysisSuggestion,
  type SponsorMediaAnalysisCapabilities,
  type SponsorMediaAnalysisSuggestion
} from '../../../../packages/funding-core/src/index.js';
import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import {
  mediaAnalysisAudit,
  requireAnalysis,
  type MediaAnalysisRow
} from './shared.js';

/** Injection port only. Production composition supplies no vision provider or network adapter. */
export interface SponsorMediaAnalysisAdapter {
  readonly version: string;
  readonly capabilities: SponsorMediaAnalysisCapabilities;
  analyze(input: {
    readonly bytes: Buffer;
    readonly checksum: string;
    readonly technical: SponsorMediaAnalysisSuggestion['technical'];
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}
export const localTechnicalMediaAdapter: SponsorMediaAnalysisAdapter = {
  version: SPONSOR_MEDIA_ANALYSIS_VERSION,
  capabilities: {
    technical: 'local',
    vision: 'not_configured',
    ocr: 'not_configured'
  },
  async analyze(input) {
    return {
      adapterVersion: SPONSOR_MEDIA_ANALYSIS_VERSION,
      checksum: input.checksum,
      capabilities: this.capabilities,
      technical: input.technical,
      altText: null,
      classification: 'unknown',
      signals:
        Math.min(input.technical.width, input.technical.height) < 200
          ? ['low_resolution']
          : [],
      limitations: [
        'VISION_NOT_CONFIGURED',
        'OCR_NOT_CONFIGURED',
        'HUMAN_CONTENT_REVIEW_REQUIRED',
        'NO_LEGAL_RIGHTS_INFERRED'
      ]
    };
  }
};

/** Verify the private processed WebP before invoking the explicitly supplied content adapter. */
export async function analyzeSponsorMediaBytes(
  bytes: Buffer,
  checksum: string,
  adapter: SponsorMediaAnalysisAdapter = localTechnicalMediaAdapter,
  signal: AbortSignal = new AbortController().signal
): Promise<SponsorMediaAnalysisSuggestion> {
  requireAnalysis(
    bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024,
    'MEDIA_ANALYSIS_FILE_INVALID'
  );
  requireAnalysis(
    createHash('sha256').update(bytes).digest('hex') === checksum,
    'MEDIA_ANALYSIS_CHECKSUM_MISMATCH'
  );
  const image = sharp(bytes, {
    failOn: 'warning',
    limitInputPixels: 40_000_000,
    sequentialRead: true
  });
  const metadata = await image.metadata();
  requireAnalysis(
    metadata.format === 'webp' &&
      metadata.width &&
      metadata.height &&
      (metadata.pages ?? 1) === 1,
    'MEDIA_ANALYSIS_FILE_INVALID'
  );
  await image.stats(); // Decode fully; a valid header alone is insufficient.
  const technical: SponsorMediaAnalysisSuggestion['technical'] = {
    width: metadata.width,
    height: metadata.height,
    sizeBytes: bytes.byteLength,
    mimeType: 'image/webp'
  };
  requireAnalysis(!signal.aborted, 'MEDIA_ANALYSIS_TIMEOUT');
  const suggestion = await adapter.analyze({
    bytes,
    checksum,
    technical,
    signal
  });
  requireAnalysis(
    validateSponsorMediaAnalysisSuggestion(
      suggestion,
      checksum,
      adapter.version
    ),
    'MEDIA_ANALYSIS_SUGGESTION_INVALID'
  );
  requireAnalysis(
    suggestion.technical.width === technical.width &&
      suggestion.technical.height === technical.height &&
      suggestion.technical.sizeBytes === technical.sizeBytes &&
      suggestion.technical.mimeType === technical.mimeType &&
      suggestion.capabilities.technical === adapter.capabilities.technical &&
      suggestion.capabilities.vision === adapter.capabilities.vision &&
      suggestion.capabilities.ocr === adapter.capabilities.ocr,
    'MEDIA_ANALYSIS_SUGGESTION_INVALID'
  );
  return suggestion;
}

export async function tickSponsorMediaAnalysis(
  pool: Pool,
  storage: Pick<SponsorMediaStorage, 'readPrivateObject'>,
  adapter: SponsorMediaAnalysisAdapter = localTechnicalMediaAdapter
): Promise<void> {
  const token = randomUUID();
  const claimed = await withPostgresTransaction(pool, async (db) => {
    const exhausted = await db.query<MediaAnalysisRow>(
      `UPDATE sponsor_media_analysis_runs SET state='failed',claim_token=NULL,lease_expires_at=NULL,finished_at=clock_timestamp(),error_code='MEDIA_ANALYSIS_ATTEMPTS_EXHAUSTED' WHERE id IN (SELECT id FROM sponsor_media_analysis_runs WHERE adapter_version=$1 AND state='processing' AND lease_expires_at<=clock_timestamp() AND attempts>=3 ORDER BY created_at,id LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *`,
      [adapter.version]
    );
    for (const run of exhausted.rows)
      await mediaAnalysisAudit(
        db,
        'media-analysis-worker',
        run.contribution_id,
        run.asset_id,
        'failed',
        { runId: run.id, code: 'MEDIA_ANALYSIS_ATTEMPTS_EXHAUSTED' }
      );
    const run = (
      await db.query<MediaAnalysisRow>(
        `UPDATE sponsor_media_analysis_runs SET state='processing',attempts=attempts+1,claim_token=$1::uuid,lease_expires_at=clock_timestamp()+INTERVAL '30 seconds',error_code=NULL WHERE id=(SELECT id FROM sponsor_media_analysis_runs WHERE adapter_version=$2 AND (state='queued' OR (state='processing' AND lease_expires_at<=clock_timestamp())) AND attempts<3 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
        [token, adapter.version]
      )
    ).rows[0];
    if (!run) return null;
    const asset = (
      await db.query<{
        processed_storage_key: string;
        checksum_sha256: string;
      }>(
        'SELECT processed_storage_key,checksum_sha256 FROM sponsor_media_assets WHERE id=$1::uuid AND contribution_id=$2::uuid AND deleted_at IS NULL',
        [run.asset_id, run.contribution_id]
      )
    ).rows[0];
    await mediaAnalysisAudit(
      db,
      'media-analysis-worker',
      run.contribution_id,
      run.asset_id,
      'started',
      { runId: run.id, attempt: run.attempts }
    );
    return { run, asset };
  });
  if (!claimed) return;
  let suggestion: SponsorMediaAnalysisSuggestion | null = null,
    errorCode: string | null = null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    requireAnalysis(
      claimed.asset?.checksum_sha256 === claimed.run.checksum,
      'MEDIA_ANALYSIS_STALE'
    );
    suggestion = await Promise.race([
      (async () => {
        const bytes = await storage.readPrivateObject(
          claimed.asset.processed_storage_key
        );
        requireAnalysis(bytes, 'MEDIA_ANALYSIS_FILE_UNAVAILABLE');
        return analyzeSponsorMediaBytes(
          bytes,
          claimed.run.checksum,
          adapter,
          controller.signal
        );
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('MEDIA_ANALYSIS_TIMEOUT'));
        }, 10_000);
      })
    ]);
  } catch (error) {
    const safe = error instanceof Error ? error.message : '';
    errorCode = [
      'MEDIA_ANALYSIS_STALE',
      'MEDIA_ANALYSIS_FILE_UNAVAILABLE',
      'MEDIA_ANALYSIS_FILE_INVALID',
      'MEDIA_ANALYSIS_CHECKSUM_MISMATCH',
      'MEDIA_ANALYSIS_TIMEOUT',
      'MEDIA_ANALYSIS_SUGGESTION_INVALID'
    ].includes(safe)
      ? safe
      : 'MEDIA_ANALYSIS_FAILED';
  } finally {
    if (timer) clearTimeout(timer);
  }
  await withPostgresTransaction(pool, async (db) => {
    // Media first, then run: same ordering as source-sensitive human review.
    const asset = (
      await db.query<{ checksum_sha256: string }>(
        'SELECT checksum_sha256 FROM sponsor_media_assets WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE',
        [claimed.run.asset_id]
      )
    ).rows[0];
    const run = (
      await db.query<MediaAnalysisRow>(
        `SELECT * FROM sponsor_media_analysis_runs WHERE id=$1::uuid AND state='processing' AND claim_token=$2::uuid AND lease_expires_at>clock_timestamp() FOR UPDATE`,
        [claimed.run.id, token]
      )
    ).rows[0];
    if (!run) return; // Expired, cancelled or replaced attempt cannot persist a result.
    const stale = asset?.checksum_sha256 !== run.checksum;
    const state =
      stale || errorCode === 'MEDIA_ANALYSIS_STALE'
        ? 'cancelled'
        : errorCode
          ? 'failed'
          : 'succeeded';
    const code = stale ? 'MEDIA_ANALYSIS_STALE' : errorCode;
    if (state === 'succeeded')
      await db.query(
        'INSERT INTO sponsor_media_analysis_suggestions(run_id,snapshot) VALUES($1::uuid,$2::jsonb)',
        [run.id, JSON.stringify(suggestion)]
      );
    await db.query(
      'UPDATE sponsor_media_analysis_runs SET state=$2,error_code=$3,finished_at=clock_timestamp(),claim_token=NULL,lease_expires_at=NULL WHERE id=$1::uuid',
      [run.id, state, code]
    );
    await mediaAnalysisAudit(
      db,
      'media-analysis-worker',
      run.contribution_id,
      run.asset_id,
      state,
      { runId: run.id, adapterVersion: run.adapter_version, code }
    );
  });
}
