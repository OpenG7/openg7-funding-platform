import { createHash } from 'node:crypto';

import type {
  SponsorshipOfferAcceptance,
  SponsorshipOfferQuote,
  SponsorshipOfferSnapshot
} from '@openg7/funding-core';
import type { SponsorshipPricingConfig } from '@openg7/funding-models';
import type { PoolClient } from 'pg';

import {
  createSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferSnapshot
} from '../../../../packages/funding-core/src/index.js';
import { CheckoutOperationError } from '../checkout-operations.service.js';

export const sponsorshipOfferFingerprint = (
  snapshot: SponsorshipOfferSnapshot | SponsorshipOfferQuote
): string => {
  // A quote adds only a derived digest; every commercial term remains validated.
  const terms = { ...snapshot } as SponsorshipOfferSnapshot & {
    fingerprint?: string;
  };
  delete terms.fingerprint;
  return createHash('sha256')
    .update(JSON.stringify(normalizeSponsorshipOfferSnapshot(terms)))
    .digest('hex');
};

export const formatRecordedSponsorshipBenefits = (
  snapshot: SponsorshipOfferSnapshot | null
): readonly string[] => {
  if (!snapshot)
    return [
      'Engagements historiques à qualifier : aucune offre acceptée enregistrée.'
    ];
  const labels = {
    website_mention: 'Mention de votre entreprise sur OpenG7.org',
    facebook_batch: 'Publication collective de reconnaissance sur Facebook',
    linkedin_batch: 'Publication collective de reconnaissance sur LinkedIn'
  };
  return snapshot.benefits.map((b) => {
    const label =
      b.id === 'website_mention' && b.target === 'openg20'
        ? 'Mention de votre entreprise sur OpenG20.org'
        : labels[b.id];
    return `${b.quantity} × ${label} (${b.target === 'openg7' ? 'OpenG7' : 'OpenG20'})`;
  });
};

export const quoteSponsorshipOffer = (
  amountMinor: number,
  currency: string,
  pricing?: SponsorshipPricingConfig
): SponsorshipOfferQuote => {
  try {
    const snapshot = createSponsorshipOfferSnapshot(
      amountMinor,
      currency,
      pricing
    );
    return { ...snapshot, fingerprint: sponsorshipOfferFingerprint(snapshot) };
  } catch {
    throw new CheckoutOperationError('SPONSORSHIP_OFFER_INVALID', 400);
  }
};

export const validateSponsorshipOfferAcceptance = (
  value: unknown
): SponsorshipOfferAcceptance | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CheckoutOperationError('SPONSORSHIP_OFFER_INVALID', 400);
  const acceptance = value as Record<string, unknown>;
  if (
    Object.keys(acceptance).some(
      (k) => !['version', 'fingerprint'].includes(k)
    ) ||
    typeof acceptance.version !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(acceptance.version) ||
    typeof acceptance.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(acceptance.fingerprint)
  )
    throw new CheckoutOperationError('SPONSORSHIP_OFFER_INVALID', 400);
  return { version: acceptance.version, fingerprint: acceptance.fingerprint };
};

/** Invoke only from durable Checkout's new-operation transaction, never on a replay. */
export const recordCheckoutSponsorshipOffer = async (
  db: PoolClient,
  operationId: string,
  input: {
    readonly publicReference: string;
    readonly quote: SponsorshipOfferQuote;
  }
): Promise<void> => {
  const { fingerprint, ...snapshot } = input.quote;
  if (sponsorshipOfferFingerprint(snapshot) !== fingerprint)
    throw new CheckoutOperationError('SPONSORSHIP_OFFER_INVALID', 400);
  await db.query(
    `INSERT INTO sponsorship_offers(checkout_operation_id, public_reference, version, fingerprint, amount_minor, currency, snapshot, provenance)
    VALUES($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,'checkout')`,
    [
      operationId,
      input.publicReference,
      snapshot.version,
      fingerprint,
      snapshot.amountMinor,
      snapshot.currency,
      JSON.stringify(snapshot)
    ]
  );
};
