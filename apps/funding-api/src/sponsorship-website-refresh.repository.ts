import { createHash } from 'node:crypto';

import type { SponsorshipWebsiteVisibilityRequest } from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { ModerationError } from './moderation/policy.js';

type Db = Pick<Pool | PoolClient, 'query'>;
export type WebsiteRefreshOutcome =
  'updated' | 'unchanged' | 'blocked' | 'conflict';

const fingerprint = (
  input: SponsorshipWebsiteVisibilityRequest,
  actor: string
) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        actor,
        contributionId: input.contributionId,
        expectedVersion: input.expectedVersion,
        visible: input.visible,
        confirmed: input.confirmed,
        refresh: {
          requestId: input.refresh!.requestId,
          obligationId: input.refresh!.obligationId,
          expectedVersion: input.refresh!.expectedVersion
        }
      })
    )
    .digest('hex');

/** A prior receipt remains a fact, even if current media has since changed. */
export async function readWebsiteRefreshReceipt(
  db: Db,
  input: SponsorshipWebsiteVisibilityRequest,
  actor: string
): Promise<WebsiteRefreshOutcome | null> {
  const result = await db.query<{
    actor: string;
    request_fingerprint: string;
    outcome: WebsiteRefreshOutcome;
  }>(
    'SELECT actor,request_fingerprint,outcome FROM sponsorship_website_refresh_commands WHERE request_id=$1::uuid',
    [input.refresh!.requestId]
  );
  const prior = result.rows[0];
  if (!prior) return null;
  if (
    prior.actor !== actor ||
    prior.request_fingerprint !== fingerprint(input, actor)
  )
    throw new ModerationError('WEBSITE_REFRESH_REQUEST_CONFLICT');
  return prior.outcome;
}

/** The caller holds this transaction-scoped lock before any receipt or proof write. */
export async function lockWebsiteRefreshRequest(
  db: Db,
  requestId: string
): Promise<void> {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('sponsorship-website-refresh:'||$1::text,0))",
    [requestId]
  );
}

/** A refresh may complete only the passage opened by an actual visibility
 * transition. Older transitions lack a target, so an existing proof prevents
 * a second passage; no recorded transition is never invented. */
export async function isWebsiteRefreshPassage(
  db: Db,
  contributionId: string,
  obligationId: string
): Promise<boolean> {
  const result = await db.query<{ allowed: boolean }>(
    `WITH transition AS (
      SELECT metadata->>'obligationId' AS obligation_id,created_at
      FROM admin_audit_log
      WHERE entity_type='sponsorship' AND entity_id=$1::text
        AND action='sponsorship_website.visibility'
        AND metadata->>'visible'='true' AND metadata->>'outcome'='updated'
      ORDER BY created_at DESC,id DESC LIMIT 1
    )
    SELECT EXISTS(SELECT 1 FROM transition WHERE
      CASE WHEN obligation_id IS NOT NULL THEN obligation_id=$2::text
      ELSE NOT EXISTS(SELECT 1 FROM sponsorship_fulfilment_evidence
        WHERE contribution_id=$1::uuid AND channel='website' AND target='openg7'
          AND recorded_at>=transition.created_at) END) AS allowed`,
    [contributionId, obligationId]
  );
  return result.rows[0]?.allowed === true;
}

export async function recordWebsiteRefreshReceipt(
  db: Db,
  input: SponsorshipWebsiteVisibilityRequest,
  actor: string,
  outcome: WebsiteRefreshOutcome
): Promise<void> {
  await db.query(
    `INSERT INTO sponsorship_website_refresh_commands
      (request_id,contribution_id,obligation_id,actor,request_fingerprint,outcome)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)`,
    [
      input.refresh!.requestId,
      input.contributionId,
      input.refresh!.obligationId,
      actor,
      fingerprint(input, actor),
      outcome
    ]
  );
}
