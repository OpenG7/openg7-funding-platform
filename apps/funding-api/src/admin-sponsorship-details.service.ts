import { createHash } from 'node:crypto';

import type {
  AdminSponsorshipDetails,
  AdminSponsorshipDetailsRequest,
  AdminSponsorshipDetailsResult
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { validateAdminSponsorshipDetails } from '../../../packages/funding-core/src/admin-sponsorship-details.js';

import { insertAdminAuditLog } from './fund-admin.repository.js';

export class SponsorshipDetailsError extends Error {
  constructor(readonly status: number) {
    super('Sponsorship details could not be updated.');
  }
}

const fields = [
  'companyName',
  'publicName',
  'contactName',
  'contactEmail',
  'websiteUrl'
] as const;
const keys = new Set<string>([
  ...fields,
  'contributionId',
  'expectedVersion',
  'requestId',
  'reason',
  'confirmed'
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const parseAdminSponsorshipDetails = (
  value: unknown
): AdminSponsorshipDetailsRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SponsorshipDetailsError(400);
  const input = value as AdminSponsorshipDetailsRequest;
  if (
    Object.keys(input).some((key) => !keys.has(key)) ||
    typeof input.contributionId !== 'string' ||
    !uuid.test(input.contributionId) ||
    typeof input.requestId !== 'string' ||
    !uuid.test(input.requestId) ||
    typeof input.expectedVersion !== 'string' ||
    !input.expectedVersion.trim() ||
    input.expectedVersion.length > 128 ||
    !['correction', 'contact_update', 'organization_update'].includes(
      input.reason
    ) ||
    input.confirmed !== true ||
    Object.keys(validateAdminSponsorshipDetails(input)).length
  )
    throw new SponsorshipDetailsError(400);
  return {
    contributionId: input.contributionId.toLowerCase(),
    requestId: input.requestId.toLowerCase(),
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    confirmed: true,
    companyName: input.companyName.trim(),
    publicName: input.publicName.trim(),
    contactName: input.contactName.trim(),
    contactEmail: input.contactEmail.trim(),
    websiteUrl: input.websiteUrl.trim()
  };
};

/** Locks the dossier and commits the correction and its minimal audit together. */
export const updateAdminSponsorshipDetails = async (
  pool: Pool,
  raw: unknown,
  actor: string
): Promise<AdminSponsorshipDetailsResult> => {
  const input = parseAdminSponsorshipDetails(raw);
  const requestHash = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<
      AdminSponsorshipDetails & { version: string }
    >(
      `
      SELECT updated_at::text AS version,
        COALESCE(sponsor_company_name, '') AS "companyName",
        COALESCE(public_name, '') AS "publicName",
        COALESCE(sponsor_contact_name, '') AS "contactName",
        COALESCE(sponsor_contact_email, '') AS "contactEmail",
        COALESCE(sponsor_website_url, '') AS "websiteUrl"
      FROM fund_contributions
      WHERE id = $1::uuid AND contribution_type = 'sponsorship_interest'
      FOR UPDATE`,
      [input.contributionId]
    );
    const current = rows[0];
    if (!current) throw new SponsorshipDetailsError(404);
    const prior = await client.query<{
      metadata: { requestHash: string; result: AdminSponsorshipDetailsResult };
    }>(
      `
      SELECT metadata FROM admin_audit_log
      WHERE entity_type = 'sponsorship' AND entity_id = $1
        AND action = 'sponsorship.details.update' AND metadata->>'requestId' = $2
      LIMIT 1`,
      [input.contributionId, input.requestId]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].metadata.requestHash !== requestHash)
        throw new SponsorshipDetailsError(409);
      await client.query('COMMIT');
      return prior.rows[0].metadata.result;
    }
    if (current.version !== input.expectedVersion)
      throw new SponsorshipDetailsError(409);
    const changedFields = fields.filter(
      (field) => current[field] !== input[field]
    );
    if (!changedFields.length) {
      await client.query('COMMIT');
      return { updated: false, version: current.version };
    }
    const updated = await client.query<{ version: string }>(
      `
      UPDATE fund_contributions SET sponsor_company_name = $2,
        public_name = NULLIF($3, ''), sponsor_contact_name = NULLIF($4, ''),
        sponsor_contact_email = NULLIF($5, ''), sponsor_website_url = NULLIF($6, ''),
        updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
      WHERE id = $1::uuid RETURNING updated_at::text AS version`,
      [input.contributionId, ...fields.map((field) => input[field])]
    );
    const result = { updated: true, version: updated.rows[0].version };
    const audited = await insertAdminAuditLog(client, {
      actor,
      action: 'sponsorship.details.update',
      entityType: 'sponsorship',
      entityId: input.contributionId,
      summary:
        'Sponsorship details corrected after administrator confirmation.',
      metadata: {
        requestId: input.requestId,
        requestHash,
        reason: input.reason,
        changedFields,
        result
      }
    });
    if (!audited) throw new SponsorshipDetailsError(503);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
