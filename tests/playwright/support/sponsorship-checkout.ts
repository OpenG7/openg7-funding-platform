import type { APIRequestContext, Locator } from '@playwright/test';
import type {
  SponsorshipOfferAcceptance,
  SponsorshipOfferQuote
} from '@openg7/funding-core';

import { expect } from './test.js';

/** Read the actual server's terms; never calculate an acceptance in a real recipe. */
export async function readSponsorshipOfferAcceptance(
  request: APIRequestContext,
  amountMinor: number
): Promise<SponsorshipOfferAcceptance> {
  const response = await request.get(
    `/api/sponsorship-offer?amountMinor=${amountMinor}&currency=CAD`
  );
  expect(response.ok()).toBe(true);
  const quote = (await response.json()) as SponsorshipOfferQuote;
  expect(quote.amountMinor).toBe(amountMinor);
  expect(quote.currency).toBe('CAD');
  expect(quote.version).toBeTruthy();
  expect(quote.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  return { version: quote.version, fingerprint: quote.fingerprint };
}

/** Called after selecting the amount, once the corresponding offer is visible. */
export async function acceptDisplayedSponsorshipOffer(
  form: Locator
): Promise<void> {
  const offer = form.locator('[data-og7="sponsorship-offer"]');
  await expect(offer).toBeVisible();
  await expect(offer).toHaveAttribute('aria-busy', 'false');
  const acceptance = form.locator('[data-og7="offer-acceptance"]');
  await expect(acceptance).toBeVisible();
  await acceptance.check();
  await expect(acceptance).toBeChecked();
}
