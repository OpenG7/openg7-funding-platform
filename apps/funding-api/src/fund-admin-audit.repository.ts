import type {
  AdminAuditLogEntry,
  AdminAuditLogResponse
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { getAdminBackofficePresence } from './fund-admin.persistence.js';

interface AuditLogRow {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string | null;
  readonly summary: string | null;
  readonly metadata: unknown;
  readonly created_at: string;
}

export interface AdminAuditLogInput {
  readonly actor: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly summary: string | null;
  readonly metadata?: Record<string, unknown>;
}

const mapAuditLogRow = (row: AuditLogRow): AdminAuditLogEntry => ({
  id: row.id,
  actor: row.actor,
  action: row.action,
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  summary: row.summary,
  metadata:
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {},
  created_at: row.created_at
});

export const insertAdminAuditLog = async (
  pool: Pool | PoolClient | null,
  input: AdminAuditLogInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_audit_log) {
    return false;
  }

  const result = await pool.query(
    `
      INSERT INTO admin_audit_log (
        actor,
        action,
        entity_type,
        entity_id,
        summary,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      input.actor,
      input.action,
      input.entityType,
      input.entityId,
      input.summary,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return (result.rowCount ?? 0) > 0;
};

export interface SponsorshipRequestAudit<Metadata> {
  readonly id: string;
  readonly actor: string;
  readonly recordedAt: string;
  readonly metadata: Metadata;
}

/** Read the receipt inside the transaction that already locked its dossier. */
export const findSponsorshipRequestAudit = async <Metadata>(
  client: PoolClient,
  input: {
    readonly contributionId: string;
    readonly action: string;
    readonly requestId: string;
  }
): Promise<SponsorshipRequestAudit<Metadata> | null> => {
  const result = await client.query<SponsorshipRequestAudit<Metadata>>(
    `SELECT id::text AS id, actor, created_at::text AS "recordedAt", metadata
     FROM admin_audit_log
     WHERE entity_type = 'sponsorship' AND entity_id = $1 AND action = $2
       AND metadata->>'requestId' = $3 LIMIT 1`,
    [input.contributionId, input.action, input.requestId]
  );
  return result.rows[0] ?? null;
};

export const listAdminAuditLog = async (
  pool: Pool | null,
  entryId?: string
): Promise<AdminAuditLogResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      data_source: 'database',
      entries: [],
      last_updated_at: now
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_audit_log) {
    return {
      data_source: 'database',
      entries: [],
      last_updated_at: now
    };
  }

  const query = await pool.query<AuditLogRow>(
    `
    SELECT
      id::text AS id,
      actor,
      action,
      entity_type,
      entity_id,
      summary,
      metadata,
      created_at::text AS created_at
    FROM admin_audit_log
    WHERE ($1::uuid IS NULL OR id = $1::uuid)
    ORDER BY created_at DESC
    LIMIT 100
  `,
    [entryId ?? null]
  );

  return {
    data_source: 'database',
    entries: query.rows.map(mapAuditLogRow),
    last_updated_at: query.rows[0]?.created_at ?? now
  };
};
