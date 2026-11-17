import type { Pool, PoolClient } from 'pg';
import type { SponsorshipWebsiteVisibilityRequest } from '@openg7/funding-core';

import { insertAdminAuditLog } from './fund-admin.repository.js';
import { lockSponsorshipContribution } from './fund-contributions.repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { SPONSOR_WEBSITE_ELIGIBLE_SQL } from './sponsorship-website-eligibility.js';
import { assertModerationApproved } from './moderation/repository.js';
import { ModerationError } from './moderation/policy.js';
import { PublicationAutomationError } from './publication-automation/policy.js';
import { recordWebsiteFulfilment } from './sponsorship-fulfilment.repository.js';
import { loadSponsorshipCommitment } from './sponsorship-commitments.repository.js';
import {
  lockWebsiteRefreshRequest,
  readWebsiteRefreshReceipt,
  recordWebsiteRefreshReceipt,
  type WebsiteRefreshOutcome
} from './sponsorship-website-refresh.repository.js';
import {
  attestWebsiteMedia,
  assertWebsiteMediaAttested,
  readWebsiteMediaSources,
  type WebsiteMediaAttestation,
  type WebsiteMediaStorage
} from './sponsorship-website-media.js';

interface WebsiteVisibilityState {
  readonly version: string;
  readonly held: boolean;
  readonly eligible: boolean;
  readonly allowed: boolean;
  readonly logoUrl: string | null;
}

async function readVisibilityState(
  db: Pool | PoolClient,
  contributionId: string
) {
  const result = await db.query<WebsiteVisibilityState>(
    `SELECT updated_at::text AS version, sponsor_site_visibility_held AS held,
      sponsor_logo_url AS "logoUrl", (${SPONSOR_WEBSITE_ELIGIBLE_SQL}) AS eligible,
      (status='paid' AND sponsorship_refund_status NOT IN ('requested','processing')
        AND NOT (sponsorship_refund_status='completed' AND COALESCE(sponsorship_refund_amount_cents,0)>=amount_cents)) AS allowed
      FROM fund_contributions WHERE id=$1 AND contribution_type='sponsorship_interest'`,
    [contributionId]
  );
  return result.rows[0] ?? null;
}

type SponsorshipWebsiteVisibilityResult =
  'updated' | 'unchanged' | 'not_found' | 'conflict' | 'blocked';

export const isSponsorshipWebsiteVisibilityRequest = (
  value: unknown
): value is SponsorshipWebsiteVisibilityRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const refresh = input.refresh as Record<string, unknown> | undefined;
  const uuid = (id: unknown): id is string =>
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return (
    Object.keys(input).every((key) =>
      [
        'contributionId',
        'expectedVersion',
        'visible',
        'confirmed',
        'refresh'
      ].includes(key)
    ) &&
    typeof input.contributionId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.contributionId
    ) &&
    typeof input.expectedVersion === 'string' &&
    input.expectedVersion.trim().length > 0 &&
    input.expectedVersion.length <= 128 &&
    typeof input.visible === 'boolean' &&
    input.confirmed === true &&
    (refresh === undefined ||
      (input.visible === true &&
        refresh !== null &&
        typeof refresh === 'object' &&
        !Array.isArray(refresh) &&
        Object.keys(refresh).every((key) =>
          ['requestId', 'obligationId', 'expectedVersion'].includes(key)
        ) &&
        uuid(refresh.requestId) &&
        uuid(refresh.obligationId) &&
        Number.isSafeInteger(refresh.expectedVersion) &&
        (refresh.expectedVersion as number) > 0))
  );
};

export const setSponsorshipWebsiteVisibility = async (
  pool: Pool,
  input: SponsorshipWebsiteVisibilityRequest,
  actor: string,
  storage?: WebsiteMediaStorage
): Promise<SponsorshipWebsiteVisibilityResult> => {
  if (!isSponsorshipWebsiteVisibilityRequest(input))
    throw new Error('Invalid website visibility decision.');
  if (input.refresh) {
    const prior = await readWebsiteRefreshReceipt(pool, input, actor);
    if (prior) return prior;
  }
  let attestation: WebsiteMediaAttestation | null = null;
  let preflightError: unknown;
  if (input.visible) {
    const planned = await readVisibilityState(pool, input.contributionId);
    if (
      planned &&
      (planned.held || input.refresh) &&
      planned.eligible &&
      planned.allowed &&
      planned.version === input.expectedVersion
    ) {
      try {
        attestation = await attestWebsiteMedia(
          pool,
          storage,
          input.contributionId,
          planned.logoUrl
        );
      } catch (error) {
        preflightError = error;
      }
    }
  }
  return withPostgresTransaction<SponsorshipWebsiteVisibilityResult>(
    pool,
    async (db) => {
      if (input.refresh) {
        await lockWebsiteRefreshRequest(db, input.refresh.requestId);
        const prior = await readWebsiteRefreshReceipt(db, input, actor);
        if (prior) return prior;
      }
      if (!(await lockSponsorshipContribution(db, input.contributionId)))
        return 'not_found';
      if (input.visible)
        await assertModerationApproved(db, {
          type: 'sponsorship',
          id: input.contributionId
        });
      // Text eligibility remains independent of optional images. Displayed
      // assets are revalidated separately, without locking their source rows
      // in an order that conflicts with a media-version trigger.
      const row = await readVisibilityState(db, input.contributionId);
      if (!row) return 'not_found';
      if (input.refresh) {
        const target = (
          await db.query<{
            version: number;
            state: string;
          }>(
            `SELECT version,state FROM sponsorship_obligations
           WHERE id=$1::uuid AND contribution_id=$2::uuid AND channel='website' AND target='openg7' FOR UPDATE`,
            [input.refresh.obligationId, input.contributionId]
          )
        ).rows[0];
        if (!target) return 'not_found';
        const complete = async (outcome: WebsiteRefreshOutcome) => {
          await recordWebsiteRefreshReceipt(db, input, actor, outcome);
          if (
            !(await insertAdminAuditLog(db, {
              actor,
              action: 'sponsorship_website.refresh',
              entityType: 'sponsorship',
              entityId: input.contributionId,
              summary: 'Explicit revalidation of one website passage.',
              metadata: {
                requestId: input.refresh!.requestId,
                obligationId: input.refresh!.obligationId,
                expectedVersion: input.refresh!.expectedVersion,
                outcome
              }
            }))
          )
            throw new Error('Website refresh audit unavailable.');
          return outcome;
        };
        if (!row.eligible || !row.allowed || row.held)
          return complete('blocked');
        if (
          row.version !== input.expectedVersion ||
          target.version !== input.refresh.expectedVersion
        )
          return complete('conflict');
        if (target.state === 'fulfilled' || target.state === 'adjusted')
          return complete('unchanged');
        if (preflightError) throw preflightError;
        const media = await readWebsiteMediaSources(
          db,
          input.contributionId,
          row.logoUrl
        );
        assertWebsiteMediaAttested(input.contributionId, media, attestation);
        try {
          const result = await recordWebsiteFulfilment(
            db,
            input.contributionId,
            actor,
            attestation!,
            input.refresh
          );
          return complete(
            result === 'fulfilled' || result === 'observed'
              ? 'updated'
              : result === 'unchanged'
                ? 'unchanged'
                : 'blocked'
          );
        } catch (error) {
          if (error instanceof PublicationAutomationError)
            throw new ModerationError(error.code, error.status);
          throw error;
        }
      }
      const outcome =
        input.visible && (!row.eligible || !row.allowed)
          ? 'blocked'
          : row.held === !input.visible
            ? 'unchanged'
            : row.version !== input.expectedVersion
              ? 'conflict'
              : 'updated';
      if (outcome === 'updated') {
        if (input.visible) {
          if (preflightError) throw preflightError;
          const media = await readWebsiteMediaSources(
            db,
            input.contributionId,
            row.logoUrl
          );
          assertWebsiteMediaAttested(input.contributionId, media, attestation);
        }
        await db.query(
          `UPDATE fund_contributions SET sponsor_site_visibility_held=$2,
        sponsor_visibility_updated_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [input.contributionId, !input.visible]
        );
      }
      if (outcome !== 'unchanged') {
        const passage =
          outcome === 'updated' && input.visible
            ? (
                await loadSponsorshipCommitment(db, input.contributionId)
              )?.obligations.find(
                (obligation) =>
                  obligation.channel === 'website' &&
                  obligation.target === 'openg7' &&
                  ['pending', 'blocked'].includes(obligation.state)
              )
            : undefined;
        const audited = await insertAdminAuditLog(db, {
          actor,
          action: 'sponsorship_website.visibility',
          entityType: 'sponsorship',
          entityId: input.contributionId,
          summary: 'Website visibility decision.',
          metadata: {
            visible: input.visible,
            outcome,
            expectedVersion: input.expectedVersion,
            ...(passage ? { obligationId: passage.id } : {})
          }
        });
        if (!audited) throw new Error('Website visibility audit unavailable.');
      }
      if (outcome === 'updated' && input.visible)
        await recordWebsiteFulfilment(
          db,
          input.contributionId,
          actor,
          attestation!
        );
      return outcome;
    }
  );
};
