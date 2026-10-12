import type { APIRequestContext, Locator } from '@playwright/test';
import type {
  SponsorshipOfferAcceptance,
  SponsorshipOfferQuote
} from '@openg7/funding-core';

import { expect } from './test.js';

/** The company explicitly accepts the loaded offer before opening Checkout. */
export async function acceptDisplayedSponsorshipOffer(
  form: Locator
): Promise<void> {
  const acceptance = form.locator('[data-og7="offer-acceptance"]');
  await expect(acceptance).toBeVisible();
  await acceptance.check();
  await expect(acceptance).toBeChecked();
}

/** Direct API journeys capture the same current terms as the browser. */
export async function acceptedSponsorshipOffer(
  request: APIRequestContext,
  amountMinor: number
): Promise<SponsorshipOfferAcceptance> {
  const response = await request.get(
    `/api/sponsorship-offer?amountMinor=${amountMinor}&currency=CAD`
  );
  expect(response.ok()).toBe(true);
  const quote = (await response.json()) as SponsorshipOfferQuote;
  expect(quote).toMatchObject({ amountMinor, currency: 'CAD' });
  expect(quote.version).toBeTruthy();
  expect(quote.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  return { version: quote.version, fingerprint: quote.fingerprint };
}
