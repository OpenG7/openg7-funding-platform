import { createHash } from 'node:crypto';

import type {
  SponsorshipCommitmentQualificationRequest,
  SponsorshipObligationAdjustmentRequest
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { normalizeSponsorshipOfferSnapshot } from '../../../../packages/funding-core/src/index.js';
import { isValidUuid } from '../business-helpers/request-validation.js';
import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';

import { sponsorshipOfferFingerprint } from './offers.js';
import {
  createSponsorshipObligations,
  loadSponsorshipCommitment
} from './repository.js';

export class SponsorshipCommitmentError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
  }
}
const text = (value: unknown, max = 2000): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= max;
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validateCommand = (
  input: unknown,
  idKey: string,
  fields: readonly string[]
): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SponsorshipCommitmentError('COMMITMENT_INVALID', 400);
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !fields.includes(key)) ||
    !isValidUuid(value.requestId) ||
    !isValidUuid(value[idKey]) ||
    value.confirmation !== value[idKey] ||
    !Number.isSafeInteger(value.expectedVersion) ||
    (value.expectedVersion as number) < 1 ||
    !text(value.reason)
  )
    throw new SponsorshipCommitmentError('COMMITMENT_INVALID', 400);
  return value;
};
const prior = async (
  db: PoolClient,
  requestId: string,
  hash: string
): Promise<boolean> => {
  const result = await db.query<{ request_fingerprint: string }>(
    'SELECT request_fingerprint FROM sponsorship_commitment_changes WHERE request_id=$1::uuid',
    [requestId]
  );
  if (!result.rows[0]) return false;
  if (result.rows[0].request_fingerprint !== hash)
    throw new SponsorshipCommitmentError('COMMITMENT_REQUEST_CONFLICT');
  return true;
};
const insertChange = async (
  db: PoolClient,
  input: {
    requestId: string;
    hash: string;
    commitmentId: string;
    obligationId?: string;
    kind: string;
    actor: string;
    reason: string;
    evidence?: string;
    before: unknown;
    after: unknown;
  }
): Promise<boolean> => {
  const result = await db.query(
    `INSERT INTO sponsorship_commitment_changes(request_id,request_fingerprint,commitment_id,obligation_id,kind,actor,reason,evidence_reference,previous_value,resulting_value)
    VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT(request_id) DO NOTHING RETURNING id`,
    [
      input.requestId,
      input.hash,
      input.commitmentId,
      input.obligationId ?? null,
      input.kind,
      input.actor,
      input.reason,
      input.evidence ?? null,
      JSON.stringify(input.before),
      JSON.stringify(input.after)
    ]
  );
  if (result.rowCount) return true;
  await prior(db, input.requestId, input.hash);
  return false;
};
const audit = async (
  db: PoolClient,
  actor: string,
  action: string,
  contributionId: string,
  requestId: string
): Promise<void> => {
  if (
    !(await insertAdminAuditLog(db, {
      actor,
      action: `sponsorship_commitment.${action}`,
      entityType: 'sponsorship',
      entityId: contributionId,
      summary:
        'Commercial commitment updated with an explicit administrative record.',
      metadata: { requestId }
    }))
  )
    throw new SponsorshipCommitmentError('COMMITMENT_AUDIT_UNAVAILABLE', 503);
};

/** Caller owns one transaction. Qualification supplies evidence; it never claims a historical Checkout acceptance. */
export const qualifySponsorshipCommitment = async (
  db: PoolClient,
  raw: unknown,
  actor: string
) => {
  const value = validateCommand(raw, 'contributionId', [
    'requestId',
    'contributionId',
    'expectedVersion',
    'confirmation',
    'reason',
    'evidenceReference',
    'offer'
  ]);
  if (!text(value.evidenceReference))
    throw new SponsorshipCommitmentError('COMMITMENT_EVIDENCE_REQUIRED', 400);
  let offer;
  try {
    offer = normalizeSponsorshipOfferSnapshot(value.offer);
  } catch {
    throw new SponsorshipCommitmentError('COMMITMENT_OFFER_INVALID', 400);
  }
  if (offer.version !== 'historical-qualification-v1')
    throw new SponsorshipCommitmentError('COMMITMENT_OFFER_INVALID', 400);
  const input: SponsorshipCommitmentQualificationRequest = {
    requestId: value.requestId as string,
    contributionId: value.contributionId as string,
    expectedVersion: value.expectedVersion as number,
    confirmation: value.confirmation as string,
    offer,
    reason: (value.reason as string).trim(),
    evidenceReference: (value.evidenceReference as string).trim()
  };
  const hash = fingerprint({ input, actor });
  const contribution = await db.query<{
    public_reference: string | null;
    amount_cents: string;
    currency: string;
  }>(
    `SELECT public_reference,amount_cents::text,currency FROM fund_contributions
    WHERE id=$1::uuid AND contribution_type='sponsorship_interest' AND status IN ('paid','refunded','disputed') FOR UPDATE`,
    [input.contributionId]
  );
  const c = contribution.rows[0];
  if (!c) throw new SponsorshipCommitmentError('COMMITMENT_NOT_FOUND', 404);
  const locked = await db.query<{ id: string; version: number; state: string }>(
    'SELECT id,version,state FROM sponsorship_commitments WHERE contribution_id=$1::uuid FOR UPDATE',
    [input.contributionId]
  );
  const m = locked.rows[0];
  if (!m) throw new SponsorshipCommitmentError('COMMITMENT_NOT_FOUND', 404);
  if (await prior(db, input.requestId, hash))
    return loadSponsorshipCommitment(db, input.contributionId);
  if (m.version !== input.expectedVersion)
    throw new SponsorshipCommitmentError('COMMITMENT_VERSION_CONFLICT');
  if (m.state !== 'needs_confirmation')
    throw new SponsorshipCommitmentError('COMMITMENT_ALREADY_ACTIVE');
  if (
    Number(c.amount_cents) !== offer.amountMinor ||
    c.currency.toUpperCase() !== offer.currency
  )
    throw new SponsorshipCommitmentError('COMMITMENT_FINANCIAL_MISMATCH');
  const changed = await insertChange(db, {
    requestId: input.requestId,
    hash,
    commitmentId: m.id,
    kind: 'qualification',
    actor,
    reason: input.reason,
    evidence: input.evidenceReference,
    before: { state: m.state, version: m.version },
    after: { offer, version: m.version + 1 }
  });
  if (!changed) return loadSponsorshipCommitment(db, input.contributionId);
  const offerRow = await db.query<{ id: string }>(
    `INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,'historical_qualification') RETURNING id`,
    [
      c.public_reference ?? input.contributionId,
      offer.version,
      sponsorshipOfferFingerprint(offer),
      offer.amountMinor,
      offer.currency,
      JSON.stringify(offer)
    ]
  );
  await db.query(
    `UPDATE sponsorship_commitments SET offer_id=$2::uuid,provenance='qualified_historical',state='active',qualification_reason=NULL,
    activated_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$1::uuid`,
    [m.id, offerRow.rows[0]!.id]
  );
  await createSponsorshipObligations(db, m.id, input.contributionId, offer);
  await audit(
    db,
    actor,
    'qualification',
    input.contributionId,
    input.requestId
  );
  return loadSponsorshipCommitment(db, input.contributionId);
};

/** Adjust terms explicitly; refunds or a refusal never silently waive an obligation. */
export const adjustSponsorshipObligation = async (
  db: PoolClient,
  raw: unknown,
  actor: string
) => {
  const value = validateCommand(raw, 'obligationId', [
    'requestId',
    'obligationId',
    'expectedVersion',
    'confirmation',
    'reason',
    'kind',
    'target'
  ]);
  if (
    !['destination', 'waiver'].includes(String(value.kind)) ||
    typeof value.kind !== 'string' ||
    (value.kind === 'destination' &&
      (typeof value.target !== 'string' ||
        !['openg7', 'openg20'].includes(value.target))) ||
    (value.kind === 'waiver' && value.target !== undefined)
  )
    throw new SponsorshipCommitmentError('COMMITMENT_INVALID', 400);
  const input: SponsorshipObligationAdjustmentRequest = {
    requestId: value.requestId as string,
    obligationId: value.obligationId as string,
    expectedVersion: value.expectedVersion as number,
    confirmation: value.confirmation as string,
    reason: (value.reason as string).trim(),
    kind: value.kind as SponsorshipObligationAdjustmentRequest['kind'],
    ...(value.target === undefined
      ? {}
      : {
          target:
            value.target as SponsorshipObligationAdjustmentRequest['target']
        })
  };
  const hash = fingerprint({ input, actor });
  const owner = await db.query<{ contribution_id: string }>(
    'SELECT contribution_id FROM sponsorship_obligations WHERE id=$1::uuid',
    [input.obligationId]
  );
  const contributionId = owner.rows[0]?.contribution_id;
  if (!contributionId)
    throw new SponsorshipCommitmentError('COMMITMENT_NOT_FOUND', 404);
  await db.query(
    'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE',
    [contributionId]
  );
  await db.query(
    'SELECT id FROM sponsorship_commitments WHERE contribution_id=$1::uuid FOR UPDATE',
    [contributionId]
  );
  const obligation = await db.query<{
    id: string;
    commitment_id: string;
    state: string;
    target: string;
    version: number;
  }>(
    'SELECT id,commitment_id,state,target,version FROM sponsorship_obligations WHERE id=$1::uuid FOR UPDATE',
    [input.obligationId]
  );
  const o = obligation.rows[0]!;
  if (await prior(db, input.requestId, hash))
    return loadSponsorshipCommitment(db, contributionId);
  if (o.version !== input.expectedVersion)
    throw new SponsorshipCommitmentError('COMMITMENT_VERSION_CONFLICT');
  if (['fulfilled', 'adjusted'].includes(o.state))
    throw new SponsorshipCommitmentError('COMMITMENT_ALREADY_COMPLETED');
  if (input.kind === 'destination' && o.target === input.target)
    throw new SponsorshipCommitmentError('COMMITMENT_UNCHANGED');
  const after = {
    state: input.kind === 'waiver' ? 'adjusted' : o.state,
    target: input.target ?? o.target,
    version: o.version + 1
  };
  if (
    await insertChange(db, {
      requestId: input.requestId,
      hash,
      commitmentId: o.commitment_id,
      obligationId: o.id,
      kind: input.kind,
      actor,
      reason: input.reason,
      before: { state: o.state, target: o.target, version: o.version },
      after
    })
  ) {
    await db.query(
      `UPDATE sponsorship_obligations SET state=$2,target=$3,version=version+1,updated_at=NOW() WHERE id=$1::uuid`,
      [o.id, after.state, after.target]
    );
    await db.query(
      'UPDATE sponsorship_commitments SET version=version+1,updated_at=NOW() WHERE id=$1::uuid',
      [o.commitment_id]
    );
    await audit(db, actor, input.kind, contributionId, input.requestId);
  }
  return loadSponsorshipCommitment(db, contributionId);
};
