import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  MEDIA_REVIEW_MAX_SELECTION,
  normalizeSponsorMediaUsage,
  type SponsorMediaBatchPlanRequest,
  type SponsorMediaRuleRequest
} from '../../../../packages/funding-core/src/index.js';
import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';

export class MediaWorkspaceError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
  }
}
export function ensure(
  value: unknown,
  code: string,
  status = 409
): asserts value {
  if (!value) throw new MediaWorkspaceError(code, status);
}
export const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
export const bounded = (
  value: unknown,
  min: number,
  max: number
): value is string =>
  typeof value === 'string' &&
  value.trim().length >= min &&
  value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(value);
export function fingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)])
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function validateCommand(input: {
  requestId: string;
  contributionId: string;
  expectedRevision: string;
}): void {
  ensure(
    input &&
      validId(input.requestId) &&
      validId(input.contributionId) &&
      typeof input.expectedRevision === 'string' &&
      /^[1-9][0-9]*$/.test(input.expectedRevision),
    'INVALID_MEDIA_COMMAND',
    400
  );
}
export function validateRules(input: SponsorMediaRuleRequest): void {
  validateCommand(input);
  ensure(
    ['dossier', 'batch', 'media'].includes(input.scope) &&
      validId(input.scopeId) &&
      input.confirmation === input.scopeId &&
      bounded(input.evidenceReference, 10, 1000) &&
      Array.isArray(input.coveredAssetIds) &&
      input.coveredAssetIds.length <= MEDIA_REVIEW_MAX_SELECTION &&
      input.coveredAssetIds.every(validId) &&
      new Set(input.coveredAssetIds).size === input.coveredAssetIds.length,
    'INVALID_MEDIA_RULES',
    400
  );
  ensure(
    input.usage === null ||
      input.coveredAssetIds.length > 0 ||
      input.includesFutureUploads === true,
    'MEDIA_AUTHORIZATION_SCOPE_REQUIRED',
    400
  );
  ensure(
    input.includesFutureUploads === undefined ||
      typeof input.includesFutureUploads === 'boolean',
    'INVALID_MEDIA_RULES',
    400
  );
  if (input.usage !== null) {
    try {
      ensure(
        normalizeSponsorMediaUsage(input.usage).state !== 'needs_confirmation',
        'MEDIA_USAGE_CONFIRMATION_REQUIRED',
        400
      );
    } catch (error) {
      if (error instanceof MediaWorkspaceError) throw error;
      throw new MediaWorkspaceError('INVALID_MEDIA_RULES', 400);
    }
  }
}
export function validatePlan(input: SponsorMediaBatchPlanRequest): void {
  validateCommand(input);
  ensure(
    [
      'approve',
      'reject',
      'delete',
      'move',
      'rules',
      'website_select',
      'website_deselect'
    ].includes(input.action) &&
      Array.isArray(input.assets) &&
      input.assets.length > 0 &&
      input.assets.length <= MEDIA_REVIEW_MAX_SELECTION &&
      input.assets.every(
        (a) =>
          a &&
          Object.keys(a).every((k) =>
            ['id', 'version', 'altText', 'usageRestrictionsConfirmed'].includes(
              k
            )
          ) &&
          validId(a.id) &&
          bounded(a.version, 1, 128) &&
          (a.altText === undefined ||
            a.altText === null ||
            bounded(a.altText, 1, 500)) &&
          (a.usageRestrictionsConfirmed === undefined ||
            a.usageRestrictionsConfirmed === true)
      ) &&
      new Set(input.assets.map((a) => a.id)).size === input.assets.length,
    'INVALID_MEDIA_SELECTION',
    400
  );
  if (input.action === 'move')
    ensure(
      input.targetBatchId === null || validId(input.targetBatchId),
      'INVALID_MEDIA_BATCH',
      400
    );
  if (input.action === 'rules')
    ensure(
      input.ruleId === null || validId(input.ruleId),
      'INVALID_MEDIA_RULES',
      400
    );
}
/** Deliveries precede dossier and media locks, matching dispatch and moderation. */
export async function lockWorkspace(
  db: PoolClient,
  contributionId: string
): Promise<string> {
  await db.query(
    `SELECT p.id FROM publication_deliveries p WHERE p.media_id IN
    (SELECT id FROM sponsor_media_assets WHERE contribution_id=$1) OR EXISTS
    (SELECT 1 FROM publication_delivery_photos ph JOIN sponsor_media_assets a ON a.id=ph.asset_id
      WHERE ph.delivery_id=p.id AND a.contribution_id=$1 AND ph.active) ORDER BY p.id FOR UPDATE OF p`,
    [contributionId]
  );
  const target = await db.query(
    `SELECT id FROM fund_contributions WHERE id=$1 AND contribution_type='sponsorship_interest' FOR UPDATE`,
    [contributionId]
  );
  ensure(target.rowCount, 'SPONSORSHIP_NOT_FOUND', 404);
  await db.query(
    'SELECT id FROM sponsor_media_assets WHERE contribution_id=$1 AND deleted_at IS NULL ORDER BY id FOR UPDATE',
    [contributionId]
  );
  await db.query(
    'INSERT INTO sponsor_media_workspaces(contribution_id) VALUES($1) ON CONFLICT DO NOTHING',
    [contributionId]
  );
  const version = await db.query(
    'SELECT revision::text AS revision FROM sponsor_media_workspaces WHERE contribution_id=$1 FOR UPDATE',
    [contributionId]
  );
  return version.rows[0].revision;
}
export async function replay(
  db: PoolClient,
  contributionId: string,
  requestId: string,
  hash: string,
  actor: string
): Promise<object | undefined> {
  const row = (
    await db.query(
      'SELECT payload_fingerprint,result,actor FROM sponsor_media_workspace_commands WHERE contribution_id=$1 AND request_id=$2',
      [contributionId, requestId]
    )
  ).rows[0];
  if (!row) return undefined;
  ensure(
    row.payload_fingerprint === hash && row.actor === actor,
    'IDEMPOTENCY_CONFLICT'
  );
  return row.result;
}
export async function record(
  db: PoolClient,
  contributionId: string,
  requestId: string,
  hash: string,
  actor: string,
  action: string,
  result: object
): Promise<void> {
  const outcome = result as {
    planId?: string;
    items?: readonly { id: string; result: string }[];
  };
  await db.query(
    'INSERT INTO sponsor_media_workspace_commands(contribution_id,request_id,payload_fingerprint,result,actor) VALUES($1,$2,$3,$4::jsonb,$5)',
    [contributionId, requestId, hash, JSON.stringify(result), actor]
  );
  ensure(
    await insertAdminAuditLog(db, {
      actor,
      action: `sponsorship.media.workspace.${action}`,
      entityType: 'sponsorship',
      entityId: contributionId,
      summary: 'Confirmed versioned media workspace command.',
      metadata: {
        requestId,
        ...(outcome.planId
          ? {
              planId: outcome.planId,
              status: 'completed',
              items: outcome.items
            }
          : {})
      }
    }),
    'MEDIA_AUDIT_UNAVAILABLE',
    503
  );
}
