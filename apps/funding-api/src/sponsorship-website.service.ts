import type { Pool } from 'pg';
import type { SponsorshipWebsiteVisibilityRequest } from '@openg7/funding-core';

import { insertAdminAuditLog } from './fund-admin.repository.js';
import { SPONSOR_WEBSITE_ELIGIBLE_SQL } from './sponsorship-website-eligibility.js';

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
  actor: string
): Promise<'updated' | 'unchanged' | 'not_found' | 'conflict' | 'blocked'> => {
  if (!isSponsorshipWebsiteVisibilityRequest(input))
    throw new Error('Invalid website visibility decision.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const locked = await db.query(
      `SELECT id FROM fund_contributions WHERE id=$1 AND contribution_type='sponsorship_interest' FOR UPDATE`,
      [input.contributionId]
    );
    if (!locked.rowCount) {
      await db.query('COMMIT');
      return 'not_found';
    }
    await db.query(
      'SELECT id FROM sponsor_media_assets WHERE contribution_id=$1 FOR SHARE',
      [input.contributionId]
    );
    const {
      rows: [row]
    } = await db.query<{
      version: string;
      held: boolean;
      eligible: boolean;
      allowed: boolean;
    }>(
      `SELECT updated_at::text AS version, sponsor_site_visibility_held AS held,
      (${SPONSOR_WEBSITE_ELIGIBLE_SQL}) AS eligible,
      (status='paid' AND sponsorship_refund_status NOT IN ('requested','processing')
        AND NOT (sponsorship_refund_status='completed' AND COALESCE(sponsorship_refund_amount_cents,0)>=amount_cents)) AS allowed
      FROM fund_contributions WHERE id=$1`,
      [input.contributionId]
    );
    const outcome =
      input.visible && (!row.eligible || !row.allowed)
        ? 'blocked'
        : row.held === !input.visible
          ? 'unchanged'
          : row.version !== input.expectedVersion
            ? 'conflict'
            : 'updated';
    if (outcome === 'updated') {
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
    await db.query('COMMIT');
    return outcome;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
};
