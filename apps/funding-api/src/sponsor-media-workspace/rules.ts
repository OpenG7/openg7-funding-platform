import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  normalizeSponsorMediaUsage,
  type SponsorMediaRuleRequest,
  type SponsorMediaBatchRequest
} from '../../../../packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import {
  ensure,
  bounded,
  fingerprint,
  lockWorkspace,
  record,
  replay,
  validateCommand,
  validateRules
} from './policy.js';
import { readWorkspace } from './read.js';

export async function setRules(
  pool: Pool,
  input: SponsorMediaRuleRequest,
  actor: string
): Promise<object> {
  validateRules(input);
  const hash = fingerprint({ action: 'rules', input });
  return withPostgresTransaction(pool, async (db) => {
    const version = await lockWorkspace(db, input.contributionId);
    const previous = await replay(
      db,
      input.contributionId,
      input.requestId,
      hash,
      actor
    );
    if (previous) return previous;
    ensure(version === input.expectedRevision, 'WORKSPACE_VERSION_CONFLICT');
    await assertRuleScope(db, input);
    if (input.scope === 'media') {
      const current = (
        await db.query(
          'SELECT sponsor_media_effective_usage(id) AS usage FROM sponsor_media_assets WHERE id=$1',
          [input.scopeId]
        )
      ).rows[0];
      ensure(
        input.usage !== null || current.usage?.state !== 'withdrawn',
        'MEDIA_USAGE_WITHDRAWN'
      );
      await db.query(
        `UPDATE sponsor_media_assets SET usage_inheritance=$2,updated_at=clock_timestamp() WHERE id=$1`,
        [input.scopeId, input.usage === null ? 'inherit' : 'override']
      );
    }
    await db.query(
      `INSERT INTO sponsor_media_rule_versions(id,contribution_id,scope_type,scope_id,revision,usage_rights,
      evidence_reference,authorization_scope,covered_asset_ids,actor,request_id)
      SELECT $1,$2,$3,$4,COALESCE(max(revision),0)+1,$5::jsonb,$6,$7,$8::uuid[],$9,$10
      FROM sponsor_media_rule_versions WHERE contribution_id=$2 AND scope_type=$3 AND scope_id=$4`,
      [
        randomUUID(),
        input.contributionId,
        input.scope,
        input.scopeId,
        input.usage === null
          ? null
          : JSON.stringify(normalizeSponsorMediaUsage(input.usage)),
        input.evidenceReference.trim(),
        input.includesFutureUploads === true ? 'scope' : 'selected',
        input.coveredAssetIds,
        actor,
        input.requestId
      ]
    );
    const result = await readWorkspace(db, input.contributionId);
    await record(
      db,
      input.contributionId,
      input.requestId,
      hash,
      actor,
      'rules',
      result
    );
    return result;
  });
}
async function assertRuleScope(
  db: PoolClient,
  input: SponsorMediaRuleRequest
): Promise<void> {
  if (input.scope === 'dossier')
    ensure(input.scopeId === input.contributionId, 'MEDIA_SCOPE_MISMATCH', 400);
  else {
    const table =
      input.scope === 'batch'
        ? 'sponsor_media_batches'
        : 'sponsor_media_assets';
    ensure(
      (
        await db.query(
          `SELECT id FROM ${table} WHERE id=$1 AND contribution_id=$2`,
          [input.scopeId, input.contributionId]
        )
      ).rowCount,
      'MEDIA_SCOPE_MISMATCH',
      400
    );
  }
  if (input.scope === 'media')
    ensure(
      ((input.usage === null && input.coveredAssetIds.length === 0) ||
        (input.coveredAssetIds.length === 1 &&
          input.coveredAssetIds[0] === input.scopeId)) &&
        !input.includesFutureUploads,
      'MEDIA_SCOPE_MISMATCH',
      400
    );
  if (input.coveredAssetIds.length) {
    const owned = await db.query(
      `SELECT id FROM sponsor_media_assets WHERE id=ANY($1::uuid[]) AND contribution_id=$2 AND deleted_at IS NULL
      AND ($3<>'batch' OR media_batch_id=$4::uuid)`,
      [input.coveredAssetIds, input.contributionId, input.scope, input.scopeId]
    );
    ensure(
      owned.rowCount === input.coveredAssetIds.length,
      'MEDIA_SCOPE_MISMATCH',
      400
    );
  }
}
export async function createBatch(
  pool: Pool,
  input: SponsorMediaBatchRequest,
  actor: string
): Promise<object> {
  validateCommand(input);
  ensure(
    input.confirmation === input.contributionId && bounded(input.name, 1, 120),
    'INVALID_MEDIA_BATCH',
    400
  );
  const hash = fingerprint({ action: 'batch', input });
  return withPostgresTransaction(pool, async (db) => {
    const version = await lockWorkspace(db, input.contributionId);
    const previous = await replay(
      db,
      input.contributionId,
      input.requestId,
      hash,
      actor
    );
    if (previous) return previous;
    ensure(version === input.expectedRevision, 'WORKSPACE_VERSION_CONFLICT');
    await db.query(
      'INSERT INTO sponsor_media_batches(contribution_id,name) VALUES($1,$2)',
      [input.contributionId, input.name.trim()]
    );
    const result = await readWorkspace(db, input.contributionId);
    await record(
      db,
      input.contributionId,
      input.requestId,
      hash,
      actor,
      'batch',
      result
    );
    return result;
  });
}
