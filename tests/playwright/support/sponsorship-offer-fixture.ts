import { createHash } from 'node:crypto';

import {
  createSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferSnapshot,
  type SponsorshipOfferQuote,
  type SponsorshipOfferSnapshot
} from '@openg7/funding-core';

/** Public terms only, never a claim that a payment or publication occurred. */
export function quoteFromSnapshot(
  snapshot: SponsorshipOfferSnapshot
): SponsorshipOfferQuote {
  const normalized = normalizeSponsorshipOfferSnapshot(snapshot);
  return {
    ...normalized,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex')
  };
}

export function syntheticSponsorshipOffer(
  amountMinor: number
): SponsorshipOfferQuote {
  return quoteFromSnapshot(createSponsorshipOfferSnapshot(amountMinor, 'CAD'));
}
