import type { Pool } from 'pg';

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export class MediaHistoryError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_MEDIA_HISTORY_REQUEST';
  constructor() {
    super('INVALID_MEDIA_HISTORY_REQUEST');
  }
}
export interface MediaHistoryEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: 'rights' | 'moderation' | 'operation';
  readonly action: string;
  readonly actor: string;
  readonly summary: string;
  readonly evidenceReference?: string;
}

/** Private paginated projection over the owning evidence tables; no parallel journal. */
export async function readMediaHistory(
  pool: Pick<Pool, 'query'>,
  contributionId: string,
  assetId?: string,
  cursor?: string
): Promise<{
  entries: readonly MediaHistoryEntry[];
  nextCursor: string | null;
}> {
  if (
    !uuid.test(contributionId) ||
    (assetId !== undefined && !uuid.test(assetId))
  )
    throw new MediaHistoryError();
  let before: { at: string; id: string } | null = null;
  if (cursor !== undefined) {
    try {
      if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))
        throw new Error();
      const value: unknown = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8')
      );
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error();
      const parsed = value as Record<string, unknown>;
      if (
        Object.keys(parsed).length !== 2 ||
        typeof parsed.at !== 'string' ||
        parsed.at.length > 64 ||
        !Number.isFinite(Date.parse(parsed.at)) ||
        typeof parsed.id !== 'string' ||
        !/^(rights|moderation|operation):[a-f0-9-]{36}$/i.test(parsed.id)
      )
        throw new Error();
      before = { at: parsed.at, id: parsed.id };
    } catch {
      throw new MediaHistoryError();
    }
  }
  const result = await pool.query<{
    id: string;
    occurred_at: string;
    kind: MediaHistoryEntry['kind'];
    action: string;
    actor: string;
    summary: string;
    evidence_reference: string | null;
  }>(
    `
    WITH entries AS (
      SELECT 'rights:'||h.id AS id,h.recorded_at AS occurred_at,'rights'::text AS kind,
        'sponsorship.media.usage'::text AS action,h.actor,
        'Versioned image usage authorization recorded.'::text AS summary,h.evidence_reference
      FROM sponsor_media_usage_history h
      WHERE h.contribution_id=$1::uuid AND ($2::uuid IS NULL OR h.asset_id=$2::uuid)
      UNION ALL
      SELECT 'rights:'||r.id,r.created_at,'rights','sponsorship.media.rules',r.actor,
        'Common image usage authorization revision recorded.',r.evidence_reference
      FROM sponsor_media_rule_versions r
      WHERE r.contribution_id=$1::uuid AND ($2::uuid IS NULL OR $2::uuid=ANY(r.covered_asset_ids)
        OR (r.scope_type='media' AND r.scope_id=$2::uuid)
        OR (r.authorization_scope='scope' AND EXISTS (SELECT 1 FROM sponsor_media_assets a
          WHERE a.id=$2::uuid AND a.contribution_id=$1::uuid AND a.created_at>=r.created_at
            AND (r.scope_type='dossier' OR r.scope_id=a.media_batch_id))))
      UNION ALL
      SELECT 'moderation:'||d.id,d.created_at,'moderation',d.level,d.actor,
        COALESCE(d.sponsor_explanation,'Versioned editorial decision recorded.'),NULL::text
      FROM moderation_decisions d
      JOIN sponsor_media_assets m ON d.subject_type='media' AND d.subject_id=m.id
      WHERE m.contribution_id=$1::uuid AND ($2::uuid IS NULL OR m.id=$2::uuid)
      UNION ALL
      SELECT 'operation:'||a.id,a.created_at,'operation',a.action,a.actor,a.summary,NULL::text
      FROM admin_audit_log a
      WHERE (a.action LIKE 'sponsorship.media.%' OR a.action LIKE 'media.%')
        AND (a.entity_id=$1::text OR a.metadata->>'contributionId'=$1::text
          OR a.entity_id IN (SELECT id::text FROM sponsor_media_assets WHERE contribution_id=$1::uuid))
        AND ($2::uuid IS NULL OR a.entity_id=$2::text OR a.metadata->>'assetId'=$2::text
          OR EXISTS (SELECT 1 FROM sponsor_media_workspace_commands command,
            jsonb_array_elements(CASE WHEN jsonb_typeof(command.result->'items')='array' THEN command.result->'items' ELSE '[]'::jsonb END) item
            WHERE command.contribution_id=$1::uuid AND command.request_id::text=a.metadata->>'requestId' AND item->>'id'=$2::text))
        AND a.action NOT IN ('sponsorship.media.usage','sponsorship.media.approved','sponsorship.media.rejected','sponsorship.media.workspace.rules')
    )
    SELECT id,occurred_at::text,kind,action,actor,summary,evidence_reference FROM entries
    WHERE ($3::timestamptz IS NULL OR (occurred_at,id)<($3::timestamptz,$4::text))
    ORDER BY occurred_at DESC,id DESC LIMIT 51
  `,
    [contributionId, assetId ?? null, before?.at ?? null, before?.id ?? null]
  );
  const page = result.rows.slice(0, 50);
  const last = page.at(-1);
  return {
    entries: page.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      kind: row.kind,
      action: row.action,
      actor: row.actor,
      summary: row.summary,
      ...(row.evidence_reference
        ? { evidenceReference: row.evidence_reference }
        : {})
    })),
    nextCursor:
      result.rows.length > 50 && last
        ? Buffer.from(
            JSON.stringify({ at: last.occurred_at, id: last.id })
          ).toString('base64url')
        : null
  };
}
