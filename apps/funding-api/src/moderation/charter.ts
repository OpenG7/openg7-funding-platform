import { createHash } from 'node:crypto';

import type {
  PublicSponsorshipCharter,
  SponsorshipCharterAcceptance
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import {
  MODERATION_POLICY_VERSION,
  SPONSORSHIP_CHARTER_TEXT,
  SPONSORSHIP_RECOGNITION_TERMS_VERSION,
  SPONSORSHIP_RECOGNITION_TERMS_TEXT,
  type SponsorshipCharterReviewPreview
} from '../../../../packages/funding-core/src/index.js';
import { CheckoutOperationError } from '../checkout-operations.service.js';

export const sponsorshipCharterFingerprint = createHash('sha256')
  .update(
    JSON.stringify({
      policyVersion: MODERATION_POLICY_VERSION,
      text: SPONSORSHIP_CHARTER_TEXT
    })
  )
  .digest('hex');

export function validateCharterAcceptance(
  value: unknown
): SponsorshipCharterAcceptance | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CheckoutOperationError('CHARTER_ACCEPTANCE_INVALID', 400);
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        !['accepted', 'policyVersion', 'fingerprint', 'locale'].includes(key)
    ) ||
    input.accepted !== true ||
    typeof input.policyVersion !== 'string' ||
    !input.policyVersion.trim() ||
    input.policyVersion.length > 64 ||
    typeof input.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.fingerprint) ||
    typeof input.locale !== 'string' ||
    !['fr-CA', 'en'].includes(input.locale)
  )
    throw new CheckoutOperationError('CHARTER_ACCEPTANCE_INVALID', 400);
  return {
    accepted: true,
    policyVersion: input.policyVersion,
    fingerprint: input.fingerprint,
    locale: input.locale as SponsorshipCharterAcceptance['locale']
  };
}

async function readSponsorshipCharter(
  db: Pick<PoolClient, 'query'>,
  lock = false
): Promise<PublicSponsorshipCharter> {
  const row = (
    await db.query<{
      public_active: boolean;
      eligible: boolean;
      public_charter_hash: string | null;
    }>(
      `SELECT public_active,public_charter_hash,
       (editorial_status='approved' AND public_validated_at<=NOW() AND effective_at<=NOW()) AS eligible
     FROM moderation_policies WHERE version=$1${lock ? ' FOR SHARE' : ''}`,
      [MODERATION_POLICY_VERSION]
    )
  ).rows[0];
  if (
    !row ||
    (row.public_active &&
      (!row.eligible ||
        row.public_charter_hash !== sponsorshipCharterFingerprint))
  )
    throw new CheckoutOperationError('CHARTER_CONFIGURATION_INVALID', 503);
  const active = row.public_active === true;
  return {
    active,
    policyVersion: MODERATION_POLICY_VERSION,
    fingerprint: active ? sponsorshipCharterFingerprint : null,
    text: active ? SPONSORSHIP_CHARTER_TEXT : null
  };
}

export const getPublicSponsorshipCharter = (db: Pick<PoolClient, 'query'>) =>
  readSponsorshipCharter(db);

/** Owner-only editorial preview. Neither reading nor downloading approves or activates either text. */
export async function getSponsorshipCharterReviewPreview(
  db: Pick<PoolClient, 'query'>
): Promise<SponsorshipCharterReviewPreview> {
  const row = (
    await db.query<{
      public_active: boolean;
      public_validated_at: Date | null;
      effective_at: Date | null;
    }>(
      'SELECT public_active,public_validated_at,effective_at FROM moderation_policies WHERE version=$1',
      [MODERATION_POLICY_VERSION]
    )
  ).rows[0];
  if (!row)
    throw new CheckoutOperationError('CHARTER_CONFIGURATION_INVALID', 503);
  return {
    active: row.public_active,
    validatedAt: row.public_validated_at?.toISOString() ?? null,
    effectiveAt: row.effective_at?.toISOString() ?? null,
    charter: {
      policyVersion: MODERATION_POLICY_VERSION,
      fingerprint: sponsorshipCharterFingerprint,
      text: SPONSORSHIP_CHARTER_TEXT
    },
    recognitionTerms: {
      status: 'proposed',
      version: SPONSORSHIP_RECOGNITION_TERMS_VERSION,
      fingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            version: SPONSORSHIP_RECOGNITION_TERMS_VERSION,
            text: SPONSORSHIP_RECOGNITION_TERMS_TEXT
          })
        )
        .digest('hex'),
      text: SPONSORSHIP_RECOGNITION_TERMS_TEXT
    }
  };
}

/** Executed only for a new durable operation, before any provider request. */
export async function recordSponsorshipCharterAcceptance(
  db: PoolClient,
  operationId: string,
  acceptance: SponsorshipCharterAcceptance | undefined
): Promise<void> {
  acceptance = validateCharterAcceptance(acceptance);
  const charter = await readSponsorshipCharter(db, true);
  if (!charter.active) {
    if (acceptance) throw new CheckoutOperationError('CHARTER_NOT_ACTIVE', 409);
    return;
  }
  if (!acceptance)
    throw new CheckoutOperationError('CHARTER_ACCEPTANCE_REQUIRED', 400);
  if (
    acceptance.policyVersion !== charter.policyVersion ||
    acceptance.fingerprint !== charter.fingerprint
  )
    throw new CheckoutOperationError('CHARTER_VERSION_CHANGED', 409);
  await db.query(
    `INSERT INTO sponsorship_charter_acceptances(operation_id,policy_version,policy_fingerprint,locale)
      VALUES($1,$2,$3,$4)`,
    [
      operationId,
      acceptance.policyVersion,
      acceptance.fingerprint,
      acceptance.locale
    ]
  );
}
