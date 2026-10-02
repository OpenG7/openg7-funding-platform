import type {
  SponsorshipIntervention,
  SponsorshipInterventionRequest,
  SponsorshipInterventionsResponse
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  findSponsorshipRequestAudit,
  type SponsorshipRequestAudit
} from './fund-admin.repository.js';

export const SPONSORSHIP_INTERVENTION_ACTION =
  'sponsorship.intervention.recorded';

type JournalRow = SponsorshipRequestAudit<
  Omit<SponsorshipInterventionRequest, 'contributionId'> & {
    requestHash: string;
  }
>;

const projectIntervention = (row: JournalRow): SponsorshipIntervention => ({
  id: row.id,
  actor: row.actor,
  recordedAt: row.recordedAt,
  kind: row.metadata.kind,
  note: row.metadata.note,
  nextReviewOn: row.metadata.nextReviewOn
});

/** Keep the request fingerprint private while sharing its durable audit lookup. */
export const findRecordedSponsorshipIntervention = async (
  client: PoolClient,
  contributionId: string,
  requestId: string
): Promise<{
  intervention: SponsorshipIntervention;
  requestHash: string;
} | null> => {
  const row = await findSponsorshipRequestAudit<JournalRow['metadata']>(
    client,
    {
      contributionId,
      action: SPONSORSHIP_INTERVENTION_ACTION,
      requestId
    }
  );
  return row
    ? {
        intervention: projectIntervention(row),
        requestHash: row.metadata.requestHash
      }
    : null;
};

export interface SponsorshipInterventionsReadModel {
  readonly entries: SponsorshipInterventionsResponse['entries'];
  readonly nextCursor: string | null;
  readonly nextReviewOn: string | null;
  readonly lastEmail: SponsorshipInterventionsResponse['followup']['lastEmail'];
}

/** Scope history and its cursor to one dossier, retaining all financial states. */
export const loadSponsorshipInterventionsReadModel = async (
  pool: Pool | PoolClient,
  contributionId: string,
  publicReference: string | null,
  cursor: string | null
): Promise<SponsorshipInterventionsReadModel> => {
  const rows = (
    await pool.query<JournalRow>(
      `SELECT id::text AS id, actor, created_at::text AS "recordedAt", metadata FROM admin_audit_log
    WHERE entity_type = 'sponsorship' AND entity_id = $1 AND action = $2
    AND ($3::uuid IS NULL OR (created_at, id) < (SELECT created_at, id FROM admin_audit_log WHERE id = $3::uuid AND entity_type = 'sponsorship' AND entity_id = $1 AND action = $2))
    ORDER BY created_at DESC, id DESC LIMIT 26`,
      [contributionId, SPONSORSHIP_INTERVENTION_ACTION, cursor]
    )
  ).rows;
  const nextReviewOn =
    (
      await pool.query<{ next: string }>(
        `SELECT metadata->>'nextReviewOn' AS next FROM admin_audit_log
    WHERE entity_type = 'sponsorship' AND entity_id = $1 AND action = $2 AND metadata->>'kind' = 'extension'
    ORDER BY created_at DESC, id DESC LIMIT 1`,
        [contributionId, SPONSORSHIP_INTERVENTION_ACTION]
      )
    ).rows[0]?.next ?? null;
  const lastEmail =
    (
      await pool.query<{ status: string; at: string }>(
        `SELECT status, COALESCE(sent_at, created_at)::text AS at FROM email_messages
    WHERE (metadata->>'contributionId' = $1 OR ($2::text IS NOT NULL AND metadata->>'publicReference' = $2)
      OR id IN (SELECT email_message_id FROM sponsorship_access_tokens WHERE contribution_id = $1::uuid))
      AND template_key IN ('sponsorship_followup', 'sponsorship_confirmation', 'sponsorship_access_recovery', 'sponsorship_information_request')
    ORDER BY created_at DESC, id DESC LIMIT 1`,
        [contributionId, publicReference]
      )
    ).rows[0] ?? null;
  return {
    entries: rows.slice(0, 25).map(projectIntervention),
    nextCursor: rows.length > 25 ? rows[24].id : null,
    nextReviewOn,
    lastEmail
  };
};
