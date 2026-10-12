import { createHash } from 'node:crypto';

import type {
  SponsorshipOfferAcceptance,
  SponsorshipOfferFormatOptions,
  SponsorshipOfferQuote,
  SponsorshipOfferSnapshot
} from '@openg7/funding-core';
import type { SponsorshipPricingConfig } from '@openg7/funding-models';
import type { PoolClient } from 'pg';

import {
  createSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferFormats,
  publicationFormatCapability
} from '../../../../packages/funding-core/src/index.js';
import { CheckoutOperationError } from '../checkout-operations.service.js';

export const sponsorshipOfferFingerprint = (
  snapshot: SponsorshipOfferSnapshot
): string =>
  createHash('sha256')
    .update(JSON.stringify(normalizeSponsorshipOfferSnapshot(snapshot)))
    .digest('hex');

export const quoteSponsorshipOffer = (
  amountMinor: number,
  currency: string,
  pricing?: SponsorshipPricingConfig,
  formats?: SponsorshipOfferFormatOptions
): SponsorshipOfferQuote => {
  try {
    for (const [channel, format] of Object.entries(formats ?? {}))
      if (!publicationFormatCapability(channel, format).available)
        throw new CheckoutOperationError('FORMAT_UNAVAILABLE', 400);
    const snapshot = createSponsorshipOfferSnapshot(
      amountMinor,
      currency,
      pricing,
      formats
    );
    return { ...snapshot, fingerprint: sponsorshipOfferFingerprint(snapshot) };
  } catch (error) {
    if (error instanceof CheckoutOperationError) throw error;
    throw new CheckoutOperationError('SPONSORSHIP_OFFER_INVALID', 400);
  }
};

export const validateSponsorshipOfferFormats = (
  value: unknown
): SponsorshipOfferFormatOptions | undefined => {
  try {
    return normalizeSponsorshipOfferFormats(value);
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
