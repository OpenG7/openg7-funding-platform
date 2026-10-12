import type { SponsorshipCommitmentQualificationRequest } from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import {
  normalizeSponsorshipOfferSnapshot,
  publicationFormatCapability
} from '../../../../packages/funding-core/src/index.js';

import {
  audit,
  fingerprint,
  insertChange,
  prior,
  SponsorshipCommitmentError,
  text,
  validateCommand
} from './change-support.js';
import { sponsorshipOfferFingerprint } from './offers.js';
import {
  createSponsorshipObligations,
  loadSponsorshipCommitment
} from './repository.js';

/** Caller owns one transaction. Qualification supplies evidence; it never claims a historical Checkout acceptance. */
export const qualifySponsorshipCommitment = async (
  db: PoolClient,
  raw: unknown,
  actor: string
) => {
  const value = validateCommand(raw, 'contributionId');
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
  for (const benefit of offer.benefits) {
    if (
      benefit.format &&
      !publicationFormatCapability(benefit.channel, benefit.format).available
    )
      throw new SponsorshipCommitmentError('FORMAT_UNAVAILABLE', 400);
  }
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
