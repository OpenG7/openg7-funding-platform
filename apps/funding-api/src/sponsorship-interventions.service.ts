import { createHash } from 'node:crypto';

import type { Pool } from 'pg';
import type {
  SponsorshipIntervention,
  SponsorshipInterventionRequest,
  SponsorshipInterventionsResponse
} from '@openg7/funding-core';

import { SPONSORSHIP_FOLLOWUP_DAYS } from '../../../packages/funding-core/src/index.js';

import { elapsedDaysSince } from './elapsed-days.js';
import {
  hasCompleteFiche,
  isActionableSponsorship
} from './sponsorship-review-policy.js';
import {
  lockSponsorshipContribution,
  listSponsorshipsForAttention,
  type SponsorshipAttentionRecord
} from './fund-contributions.repository.js';
import {
  findSponsorshipRequestAudit,
  insertAdminAuditLog,
  type SponsorshipRequestAudit
} from './fund-admin.repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';

export class SponsorshipInterventionError extends Error {
  constructor(readonly status: number) {
    super('Sponsorship interventions unavailable.');
  }
}
const action = 'sponsorship.intervention.recorded';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys = new Set([
  'contributionId',
  'requestId',
  'kind',
  'note',
  'nextReviewOn'
]);
export const interventionId = (value: unknown): string => {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new SponsorshipInterventionError(400);
  return value.toLowerCase();
};
export const parseSponsorshipIntervention = (
  raw: unknown
): SponsorshipInterventionRequest => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new SponsorshipInterventionError(400);
  const input = raw as SponsorshipInterventionRequest;
  const date = input.nextReviewOn;
  if (
    Object.keys(input).some((key) => !keys.has(key)) ||
    !['email', 'phone', 'internal', 'extension', 'refund_review'].includes(
      input.kind
    ) ||
    typeof input.note !== 'string' ||
    !input.note.trim() ||
    input.note.length > 2000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.note) ||
    (date !== null &&
      (typeof date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)) ||
    (input.kind === 'extension' ? date === null : date !== null)
  )
    throw new SponsorshipInterventionError(400);
  return {
    contributionId: interventionId(input.contributionId),
    requestId: interventionId(input.requestId),
    kind: input.kind,
    note: input.note.trim(),
    nextReviewOn: date
  };
};

type JournalRow = SponsorshipRequestAudit<
  Omit<SponsorshipInterventionRequest, 'contributionId'> & {
    requestHash: string;
  }
>;
const projection = (row: JournalRow): SponsorshipIntervention => ({
  id: row.id,
  actor: row.actor,
  recordedAt: row.recordedAt,
  kind: row.metadata.kind,
  note: row.metadata.note,
  nextReviewOn: row.metadata.nextReviewOn
});
const columns =
  'id::text AS id, actor, created_at::text AS "recordedAt", metadata';
/** Serialize retries on the dossier; the journal is append-only and is its own audit. */
export const recordSponsorshipIntervention = async (
  pool: Pool,
  raw: unknown,
  actor: string
): Promise<SponsorshipIntervention> => {
  const input = parseSponsorshipIntervention(raw);
  const requestHash = createHash('sha256')
    .update(JSON.stringify([actor, input]))
    .digest('hex');
  return withPostgresTransaction(pool, async (client) => {
    if (!(await lockSponsorshipContribution(client, input.contributionId)))
      throw new SponsorshipInterventionError(404);
    const prior = await findSponsorshipRequestAudit<JournalRow['metadata']>(
      client,
      {
        contributionId: input.contributionId,
        action,
        requestId: input.requestId
      }
    );
    if (prior) {
      if (prior.metadata.requestHash !== requestHash)
        throw new SponsorshipInterventionError(409);
      return projection(prior);
    }
    if (
      input.nextReviewOn &&
      input.nextReviewOn <= new Date().toISOString().slice(0, 10)
    )
      throw new SponsorshipInterventionError(400);
    const recorded = await insertAdminAuditLog(client, {
      actor,
      action,
      entityType: 'sponsorship',
      entityId: input.contributionId,
      summary: 'Administrative intervention recorded.',
      metadata: {
        requestId: input.requestId,
        requestHash,
        kind: input.kind,
        note: input.note,
        nextReviewOn: input.nextReviewOn
      }
    });
    if (!recorded) throw new SponsorshipInterventionError(503);
    const entry = await findSponsorshipRequestAudit<JournalRow['metadata']>(
      client,
      {
        contributionId: input.contributionId,
        action,
        requestId: input.requestId
      }
    );
    if (!entry) throw new SponsorshipInterventionError(503);
    return projection(entry);
  });
};

export const sponsorshipFollowupState = (
  record: SponsorshipAttentionRecord,
  nextReviewOn: string | null,
  now = new Date()
): Omit<SponsorshipInterventionsResponse['followup'], 'lastEmail'> => {
  const elapsedDays = elapsedDaysSince(now, record.paidAt);
  const ageDays = elapsedDays === null ? null : Math.max(0, elapsedDays);
  let state: SponsorshipInterventionsResponse['followup']['state'];
  if (!isActionableSponsorship(record) || record.reviewStatus === 'rejected')
    state = 'inactive';
  else if (hasCompleteFiche(record)) state = 'complete';
  else if (nextReviewOn && nextReviewOn > now.toISOString().slice(0, 10))
    state = 'extended';
  else if (
    nextReviewOn ||
    (ageDays !== null && ageDays >= SPONSORSHIP_FOLLOWUP_DAYS.decision)
  )
    state = 'decision_required';
  else if (ageDays !== null && ageDays >= SPONSORSHIP_FOLLOWUP_DAYS.second)
    state = 'second_reminder';
  else if (ageDays !== null && ageDays >= SPONSORSHIP_FOLLOWUP_DAYS.first)
    state = 'first_reminder';
  else state = 'waiting';
  return { state, ageDays, nextReviewOn };
};

export const getSponsorshipInterventions = async (
  pool: Pool,
  rawId: unknown,
  rawCursor: unknown = null
): Promise<SponsorshipInterventionsResponse> => {
  const id = interventionId(rawId);
  const cursor = rawCursor === null ? null : interventionId(rawCursor);
  const record = (await listSponsorshipsForAttention(pool, 2, id)).items.find(
    (item) => item.contributionId === id
  );
  if (!record) throw new SponsorshipInterventionError(404);
  // Scope cursors to this dossier; new entries cannot shift older history pages.
  const rows = (
    await pool.query<JournalRow>(
      `SELECT ${columns} FROM admin_audit_log
    WHERE entity_type = 'sponsorship' AND entity_id = $1 AND action = $2
    AND ($3::uuid IS NULL OR (created_at, id) < (SELECT created_at, id FROM admin_audit_log WHERE id = $3::uuid AND entity_type = 'sponsorship' AND entity_id = $1 AND action = $2))
    ORDER BY created_at DESC, id DESC LIMIT 26`,
      [id, action, cursor]
    )
  ).rows;
  const extension =
    (
      await pool.query<{ next: string }>(
        `SELECT metadata->>'nextReviewOn' AS next FROM admin_audit_log
    WHERE entity_type = 'sponsorship' AND entity_id = $1 AND action = $2 AND metadata->>'kind' = 'extension'
    ORDER BY created_at DESC, id DESC LIMIT 1`,
        [id, action]
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
        [id, record.publicReference]
      )
    ).rows[0] ?? null;
  return {
    entries: rows.slice(0, 25).map(projection),
    nextCursor: rows.length > 25 ? rows[24].id : null,
    followup: { ...sponsorshipFollowupState(record, extension), lastEmail }
  };
};
