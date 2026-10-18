import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';

export class SponsorMediaAnalysisError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
    this.name = 'SponsorMediaAnalysisError';
  }
}
export function requireAnalysis(
  condition: unknown,
  code: string,
  status = 409
): asserts condition {
  if (!condition) throw new SponsorMediaAnalysisError(code, status);
}
export const analysisHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function mediaAnalysisAudit(
  db: PoolClient,
  actor: string,
  contributionId: string,
  assetId: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const result = await insertAdminAuditLog(db, {
    actor,
    action: 'sponsorship.media.analysis.' + action,
    entityType: 'sponsor_media_asset',
    entityId: assetId,
    summary:
      'Private content assistance; no usage right, media approval or publication granted.',
    metadata: { contributionId, ...metadata }
  });
  requireAnalysis(result, 'MEDIA_ANALYSIS_AUDIT_UNAVAILABLE', 503);
}
export interface MediaAnalysisRow {
  id: string;
  contribution_id: string;
  asset_id: string;
  checksum: string;
  adapter_version: string;
  state: import('../../../../packages/funding-core/src/index.js').SponsorMediaAnalysisRun['state'];
  error_code: string | null;
  attempts: number;
  created_at: string;
  finished_at: string | null;
}
