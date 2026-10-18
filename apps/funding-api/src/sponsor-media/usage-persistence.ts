import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import type {
  SponsorMediaAsset,
  SponsorMediaPreference,
  SponsorMediaUsageRights
} from '@openg7/funding-core';

import { normalizeSponsorMediaUsage } from '../../../../packages/funding-core/src/index.js';
import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';
import { lockModerationDependencies } from '../moderation/content.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import { mapAsset } from './persistence-mappers.js';
import {
  getAssetForUpdate,
  selectAssetColumns
} from './persistence-queries.js';
import type { SponsorMediaAssetRow } from './persistence-contracts.js';

export class SponsorMediaUsageError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
  }
}
const ensure = (condition: unknown, code: string, status = 409): void => {
  if (!condition) throw new SponsorMediaUsageError(code, status);
};
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const text = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length >= 10 &&
  value.length <= 1000 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(value);
const emptyPreference: SponsorMediaPreference = {
  revision: 0,
  preferredAssetId: null,
  correction: null,
  state: 'none',
  sponsorExplanation: null,
  available: true
};

export async function getSponsorMediaPreference(
  db: Pool | PoolClient | null,
  contributionId: string
): Promise<SponsorMediaPreference> {
  if (!db) return emptyPreference;
  const result = await db.query(
    `SELECT p.*, (p.preferred_asset_id IS NULL OR EXISTS(
    SELECT 1 FROM sponsor_media_assets m WHERE m.id=p.preferred_asset_id AND m.contribution_id=p.contribution_id
      AND m.deleted_at IS NULL AND sponsor_media_effective_usage(m.id)->>'state'<>'withdrawn')) AS available
    FROM sponsor_media_preferences p WHERE p.contribution_id=$1`,
    [contributionId]
  );
  const row = result.rows[0];
  return row
    ? {
        revision: row.revision,
        preferredAssetId: row.preferred_asset_id,
        correction: row.correction,
        state: row.state,
        sponsorExplanation: row.sponsor_explanation,
        available: row.available
      }
    : emptyPreference;
}

interface CommandInput {
  readonly contributionId: string;
  readonly requestId: string;
  readonly actor: string;
  readonly operation: 'usage' | 'preference' | 'preference_review';
  readonly payload: object;
  readonly assetId?: string;
}
async function command<T extends object>(
  pool: Pool | null,
  input: CommandInput,
  mutate: (db: PoolClient) => Promise<T>
): Promise<T> {
  ensure(pool, 'MEDIA_USAGE_UNAVAILABLE', 503);
  ensure(
    uuid.test(input.requestId) && uuid.test(input.contributionId),
    'INVALID_MEDIA_USAGE_REQUEST',
    400
  );
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(input.payload))
    .digest('hex');
  return withPostgresTransaction(pool!, async (db) => {
    const replay = async (): Promise<T | undefined> => {
      const previous = (
        await db.query(
          `SELECT operation,payload_fingerprint,result FROM sponsor_media_usage_commands
        WHERE contribution_id=$1 AND request_id=$2`,
          [input.contributionId, input.requestId]
        )
      ).rows[0];
      if (!previous) return undefined;
      ensure(
        previous.operation === input.operation &&
          previous.payload_fingerprint === fingerprint,
        'IDEMPOTENCY_CONFLICT'
      );
      return previous.result as T;
    };
    const recorded = await replay();
    if (recorded) return recorded;
    if (input.assetId) {
      const owned = await db.query(
        `SELECT id FROM sponsor_media_assets WHERE id=$1 AND contribution_id=$2 AND deleted_at IS NULL`,
        [input.assetId, input.contributionId]
      );
      ensure(owned.rowCount, 'MEDIA_NOT_FOUND', 404);
      await lockModerationDependencies(db, {
        type: 'media',
        id: input.assetId
      });
    }
    const contribution = await db.query(
      `SELECT id FROM fund_contributions WHERE id=$1
      AND contribution_type='sponsorship_interest' FOR UPDATE`,
      [input.contributionId]
    );
    ensure(contribution.rowCount, 'MEDIA_NOT_FOUND', 404);
    const concurrent = await replay();
    if (concurrent) return concurrent;
    const result = await mutate(db);
    await db.query(
      `INSERT INTO sponsor_media_usage_commands(contribution_id,request_id,operation,payload_fingerprint,result)
      VALUES($1,$2,$3,$4,$5::jsonb)`,
      [
        input.contributionId,
        input.requestId,
        input.operation,
        fingerprint,
        JSON.stringify(result)
      ]
    );
    const audit = await insertAdminAuditLog(db, {
      actor: input.actor,
      action: `sponsorship.media.${input.operation}`,
      entityType: 'contribution',
      entityId: input.contributionId,
      summary: 'Versioned sponsorship image usage or preference recorded.',
      metadata: { requestId: input.requestId, assetId: input.assetId ?? null }
    });
    ensure(audit, 'MEDIA_USAGE_AUDIT_UNAVAILABLE', 503);
    return result;
  });
}

export async function updateSponsorMediaUsage(
  pool: Pool | null,
  input: {
    readonly contributionId: string;
    readonly assetId: string;
    readonly requestId: string;
    readonly expectedVersion: string;
    readonly actor: string;
    readonly usage: SponsorMediaUsageRights;
    readonly evidenceReference?: string;
  }
): Promise<{ updated: true; asset: SponsorMediaAsset }> {
  let usage: SponsorMediaUsageRights;
  try {
    usage = normalizeSponsorMediaUsage(input.usage);
  } catch {
    throw new SponsorMediaUsageError('INVALID_MEDIA_USAGE_REQUEST', 400);
  }
  ensure(
    usage.state !== 'needs_confirmation',
    'MEDIA_USAGE_CONFIRMATION_REQUIRED',
    400
  );
  if (input.evidenceReference !== undefined)
    ensure(text(input.evidenceReference), 'MEDIA_USAGE_EVIDENCE_REQUIRED', 400);
  const payload = {
    assetId: input.assetId,
    expectedVersion: input.expectedVersion,
    usage,
    evidenceReference: input.evidenceReference?.trim() ?? null
  };
  return command(
    pool,
    { ...input, operation: 'usage', payload },
    async (db) => {
      const current = await getAssetForUpdate(db, input.assetId);
      ensure(
        current?.contribution_id === input.contributionId,
        'MEDIA_NOT_FOUND',
        404
      );
      ensure(current!.version === input.expectedVersion, 'VERSION_CONFLICT');
      const row = (
        await db.query<SponsorMediaAssetRow>(
          `UPDATE sponsor_media_assets SET usage_rights=$2::jsonb,usage_inheritance='legacy',
      usage_restrictions_reviewed=FALSE,review_status='pending_review',public_url=NULL,reviewed_at=NULL,reviewed_by=NULL,
      updated_at=clock_timestamp() WHERE id=$1 RETURNING ${selectAssetColumns}`,
          [input.assetId, JSON.stringify(usage)]
        )
      ).rows[0]!;
      await db.query(
        `INSERT INTO sponsor_media_usage_history(asset_id,contribution_id,request_id,usage_rights,evidence_reference,actor)
      VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
        [
          input.assetId,
          input.contributionId,
          input.requestId,
          JSON.stringify(usage),
          input.evidenceReference?.trim() ?? null,
          input.actor
        ]
      );
      return { updated: true, asset: mapAsset(row) };
    }
  );
}

export async function requestSponsorMediaPreference(
  pool: Pool | null,
  input: {
    readonly contributionId: string;
    readonly requestId: string;
    readonly expectedRevision: number;
    readonly assetId: string | null;
    readonly correction: string | null;
    readonly actor: string;
  }
): Promise<{ updated: true; preference: SponsorMediaPreference }> {
  ensure(
    Number.isSafeInteger(input.expectedRevision) &&
      input.expectedRevision >= 0 &&
      (input.assetId === null || uuid.test(input.assetId)) &&
      (input.correction === null || text(input.correction)),
    'INVALID_MEDIA_PREFERENCE',
    400
  );
  const payload = {
    expectedRevision: input.expectedRevision,
    assetId: input.assetId,
    correction: input.correction?.trim() ?? null
  };
  return command(
    pool,
    { ...input, assetId: undefined, operation: 'preference', payload },
    async (db) => {
      const current = await getSponsorMediaPreference(db, input.contributionId);
      ensure(current.revision === input.expectedRevision, 'VERSION_CONFLICT');
      if (input.assetId) {
        const selected = await getAssetForUpdate(db, input.assetId);
        ensure(
          selected?.contribution_id === input.contributionId &&
            selected.kind === 'supporting_image' &&
            normalizeSponsorMediaUsage(selected.usage_rights).state !==
              'withdrawn',
          'MEDIA_NOT_FOUND',
          404
        );
      }
      await db.query(
        `INSERT INTO sponsor_media_preferences(contribution_id,revision,preferred_asset_id,correction,state)
      VALUES($1,$2,$3,$4,'pending') ON CONFLICT(contribution_id) DO UPDATE SET revision=EXCLUDED.revision,
        preferred_asset_id=EXCLUDED.preferred_asset_id,correction=EXCLUDED.correction,state='pending',sponsor_explanation=NULL,updated_at=clock_timestamp()`,
        [
          input.contributionId,
          current.revision + 1,
          input.assetId,
          input.correction?.trim() ?? null
        ]
      );
      return {
        updated: true,
        preference: await getSponsorMediaPreference(db, input.contributionId)
      };
    }
  );
}

export async function decideSponsorMediaPreference(
  pool: Pool | null,
  input: {
    readonly contributionId: string;
    readonly requestId: string;
    readonly expectedRevision: number;
    readonly state: 'accepted' | 'rejected';
    readonly sponsorExplanation: string;
    readonly actor: string;
  }
): Promise<{ updated: true; preference: SponsorMediaPreference }> {
  ensure(
    ['accepted', 'rejected'].includes(input.state) &&
      text(input.sponsorExplanation) &&
      Number.isSafeInteger(input.expectedRevision) &&
      input.expectedRevision > 0,
    'INVALID_MEDIA_PREFERENCE_DECISION',
    400
  );
  const payload = {
    expectedRevision: input.expectedRevision,
    state: input.state,
    sponsorExplanation: input.sponsorExplanation.trim()
  };
  return command(
    pool,
    { ...input, operation: 'preference_review', payload },
    async (db) => {
      const current = await getSponsorMediaPreference(db, input.contributionId);
      ensure(
        current.revision === input.expectedRevision &&
          current.state === 'pending',
        'VERSION_CONFLICT'
      );
      ensure(
        input.state !== 'accepted' || current.available,
        'MEDIA_NOT_FOUND',
        404
      );
      await db.query(
        `UPDATE sponsor_media_preferences SET revision=revision+1,state=$2,sponsor_explanation=$3,
      updated_at=clock_timestamp() WHERE contribution_id=$1`,
        [input.contributionId, input.state, input.sponsorExplanation.trim()]
      );
      return {
        updated: true,
        preference: await getSponsorMediaPreference(db, input.contributionId)
      };
    }
  );
}
