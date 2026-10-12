import type { Pool, PoolClient } from 'pg';
import type { SponsorshipWebsiteVisibilityRequest } from '@openg7/funding-core';

import { insertAdminAuditLog } from './fund-admin.repository.js';
import { lockSponsorshipContribution } from './fund-contributions.repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { SPONSOR_WEBSITE_ELIGIBLE_SQL } from './sponsorship-website-eligibility.js';
import { assertModerationApproved } from './moderation/repository.js';
import { recordWebsiteFulfilment } from './sponsorship-fulfilment.repository.js';
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
  return (
    Object.keys(input).every((key) =>
      ['contributionId', 'expectedVersion', 'visible', 'confirmed'].includes(
        key
      )
    ) &&
    typeof input.contributionId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.contributionId
    ) &&
    typeof input.expectedVersion === 'string' &&
    input.expectedVersion.trim().length > 0 &&
    input.expectedVersion.length <= 128 &&
    typeof input.visible === 'boolean' &&
    input.confirmed === true
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
  let attestation: WebsiteMediaAttestation | null = null;
  let preflightError: unknown;
  if (input.visible) {
    const planned = await readVisibilityState(pool, input.contributionId);
    if (
      planned?.held &&
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
      if (!(await lockSponsorshipContribution(db, input.contributionId)))
        return 'not_found';
      if (input.visible)
        await assertModerationApproved(db, {
          type: 'sponsorship',
          id: input.contributionId
        });
      // Eligibility reads the current media decisions below. A later media
      // restriction immediately removes public visibility through the same SQL
      // guard, without a source lock that conflicts with its version trigger.
      const row = await readVisibilityState(db, input.contributionId);
      if (!row) return 'not_found';
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
        const audited = await insertAdminAuditLog(db, {
          actor,
          action: 'sponsorship_website.visibility',
          entityType: 'sponsorship',
          entityId: input.contributionId,
          summary: 'Website visibility decision.',
          metadata: {
            visible: input.visible,
            outcome,
            expectedVersion: input.expectedVersion
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
