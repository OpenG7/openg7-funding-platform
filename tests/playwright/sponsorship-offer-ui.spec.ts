import { AxeBuilder } from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import type { SponsorshipOfferQuote } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  quoteFromSnapshot,
  syntheticSponsorshipOffer
} from './support/sponsorship-offer-fixture.js';

const emptyReport = {
  data_source: 'database',
  total_received: 0,
  total_fees: 0,
  total_net: 0,
  total_refunded: 0,
  total_payouts: 0,
  current_available_estimate: 0,
  contributions_count: 0,
  currency: 'CAD',
  monthly_summary: [],
  latest_public_allocations: [],
  public_builders: [],
  last_updated_at: '2026-10-11T12:00:00.000Z'
};

async function setupPublicApis(context: BrowserContext) {
  await context.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/public/funding-config')
      return route.fulfill({
        json: {
          business_sponsorship_enabled: true,
          allowed_contribution_amounts: [5, 10, 25, 50]
        }
      });
    if (pathname === '/api/public/fund-transparency')
      return route.fulfill({ json: emptyReport });
    if (pathname === '/api/sponsorship-charter')
      return route.fulfill({
        json: {
          active: false,
          policyVersion: '1.0',
          fingerprint: null,
          text: null
        }
      });
    if (pathname === '/api/public/sponsorship-batches/availability')
      return route.fulfill({
        json: { data_source: 'empty', availability: [], slots: [] }
      });
    return route.fulfill({ status: 503, json: {} });
  });
}

const form = (page: Page) => page.locator('[data-og7="contribution-form"]');
const submit = (page: Page) => form(page).locator('button[type="submit"]');
const acceptance = (page: Page) =>
  form(page).locator('[data-og7="offer-acceptance"]');
const offer = (page: Page) =>
  form(page).locator('[data-og7="sponsorship-offer"]');
const path = (english: boolean) =>
  `${english ? '/en' : ''}/fonds-des-batisseurs?intent=sponsorship`;
const acknowledge = (page: Page, english: boolean) =>
  form(page)
    .getByLabel(
      english
        ? /OpenG7 is an independent project/
        : /OpenG7 est un projet indépendant/
    )
    .check();
const mockedResult = {
  status: 'mocked',
  checkoutId: 'synthetic-browser-offer',
  redirectUrl: 'https://example.test/unused'
};

function revisedOffer(previous: SponsorshipOfferQuote): SponsorshipOfferQuote {
  return quoteFromSnapshot({
    amountMinor: previous.amountMinor,
    currency: previous.currency,
    version: 'synthetic-offer-v2',
    benefits: previous.benefits.map((benefit) => ({
      ...benefit,
      quantity: 2,
      target: 'openg20',
      deadlineDays: 30,
      durationDays: 90
    }))
  });
}

for (const english of [false, true]) {
  const variant = english ? 'EN mobile' : 'FR desktop';
  test.describe(variant, () => {
    test.beforeEach(async ({ page, context }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      await setupPublicApis(context);
    });

    test(`sponsorship offer changes require a fresh human confirmation before a new Checkout (${variant})`, async ({
      page,
      context
    }) => {
      let current = syntheticSponsorshipOffer(5000);
      const original = current;
      const requests: Record<string, unknown>[] = [];
      await context.route('**/api/sponsorship-offer?**', (route) =>
        route.fulfill({ json: current })
      );
      await context.route('**/api/checkout-sessions', (route) => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) {
          current = revisedOffer(original);
          return route.fulfill({
            status: 409,
            json: { code: 'SPONSORSHIP_OFFER_CHANGED' }
          });
        }
        return route.fulfill({ json: mockedResult });
      });
      await page.goto(path(english));
      await acknowledge(page, english);
      await expect(offer(page)).toContainText('sponsorship-v1');
      await expect(submit(page)).toBeDisabled();
      await acceptance(page).focus();
      await page.keyboard.press('Space');
      await expect(acceptance(page)).toBeChecked();
      await submit(page).click();
      await expect(offer(page)).toContainText('synthetic-offer-v2');
      await expect(offer(page)).toContainText('2 ×');
      await expect(offer(page)).toContainText('OPENG20');
      await expect(offer(page)).toContainText(english ? '30 days' : '30 jours');
      await expect(offer(page)).toContainText(english ? '90 days' : '90 jours');
      await expect(acceptance(page)).not.toBeChecked();
      await expect(submit(page)).toBeDisabled();
      await form(page).dispatchEvent('submit');
      expect(requests).toHaveLength(1);
      await acceptance(page).check();
      await submit(page).click();
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[0].offerAcceptance).toEqual({
        version: original.version,
        fingerprint: original.fingerprint
      });
      expect(requests[1].offerAcceptance).toEqual({
        version: current.version,
        fingerprint: current.fingerprint
      });
      expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
      expect(requests[1]).not.toHaveProperty('offerQuote');
      expect(requests[1]).not.toHaveProperty('benefits');
      await expect(
        page.locator('[data-og7="home-funding-totals"]')
      ).toContainText(
        english ? '0 confirmed contributions' : '0 contributions confirmées'
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      const audit = await new AxeBuilder({ page })
        .include('[data-og7="contribution-form"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(audit.violations).toEqual([]);
    });

    test(`sponsorship offer survives a closed tab and keeps the submitted key despite a changed server tariff (${variant})`, async ({
      page,
      context
    }) => {
      const original = quoteFromSnapshot({
        version: 'synthetic-retained-v0',
        amountMinor: 4500,
        currency: 'CAD',
        benefits: syntheticSponsorshipOffer(5000).benefits
      });
      let quoteReads = 0;
      let current = original;
      const requests: Record<string, unknown>[] = [];
      await context.route('**/api/sponsorship-offer?**', (route) => {
        quoteReads++;
        const amountMinor = Number(
          new URL(route.request().url()).searchParams.get('amountMinor')
        );
        return route.fulfill({
          json:
            amountMinor === 4500
              ? current
              : syntheticSponsorshipOffer(amountMinor)
        });
      });
      await context.route('**/api/checkout-sessions', (route) => {
        requests.push(route.request().postDataJSON());
        return requests.length === 1
          ? route.abort('failed')
          : route.fulfill({ json: mockedResult });
      });
      await page.goto(path(english));
      await form(page).locator('#custom-contribution').fill('45');
      await expect(offer(page)).toContainText('synthetic-retained-v0');
      await acknowledge(page, english);
      await acceptance(page).check();
      await submit(page).click();
      await expect(form(page).getByRole('alert')).toBeVisible();
      await expect.poll(() => requests.length).toBe(1);
      const serialized = await page.evaluate(() =>
        JSON.stringify({
          attempts: localStorage.getItem('openg7.checkout-attempts.v2'),
          offer: localStorage.getItem('openg7.checkout-offer-recovery.v1')
        })
      );
      expect(serialized).not.toContain('successUrl');
      expect(serialized).not.toContain('publicDisplayName');
      const readsBeforeClose = quoteReads;
      current = revisedOffer(original);
      await page.close();
      const reopened = await context.newPage();
      await reopened.goto(path(english));
      await expect(offer(reopened)).toContainText(
        english
          ? 'originally confirmed offer is retained'
          : 'offre initialement confirmée est conservée'
      );
      await expect(offer(reopened)).not.toContainText('synthetic-offer-v2');
      expect(quoteReads).toBe(readsBeforeClose);
      await expect(acceptance(reopened)).not.toBeChecked();
      await expect(submit(reopened)).toBeDisabled();
      await offer(reopened)
        .getByRole('button', {
          name: english ? /Resume the/ : /Reprendre la commandite/
        })
        .click();
      await acknowledge(reopened, english);
      await acceptance(reopened).check();
      await submit(reopened).click();
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[1]).toEqual(requests[0]);
      await expect(
        reopened.getByText(
          english ? 'Payment received by Stripe' : 'Paiement reçu par Stripe',
          { exact: true }
        )
      ).toHaveCount(0);
    });

    test(`sponsorship offer cannot replace an uncertain operation after changing its consent (${variant})`, async ({
      page,
      context
    }) => {
      const quoted = syntheticSponsorshipOffer(5000);
      let calls = 0;
      await context.route('**/api/sponsorship-offer?**', (route) =>
        route.fulfill({ json: quoted })
      );
      await context.route('**/api/checkout-sessions', (route) => {
        calls++;
        return route.abort('failed');
      });
      await page.goto(path(english));
      await acknowledge(page, english);
      await acceptance(page).check();
      await submit(page).click();
      await expect(form(page).getByRole('alert')).toBeVisible();
      const retained = await page.evaluate(() =>
        localStorage.getItem('openg7.checkout-attempts.v2')
      );
      await form(page)
        .getByLabel(
          english
            ? /individual amount to be displayed/i
            : /affichage du montant/i
        )
        .check();
      await submit(page).click();
      await expect(form(page).getByRole('alert')).toContainText(
        english ? 'requires verification' : 'nécessite une vérification'
      );
      await expect(submit(page)).toBeDisabled();
      expect(calls).toBe(1);
      expect(
        await page.evaluate(() =>
          localStorage.getItem('openg7.checkout-attempts.v2')
        )
      ).toBe(retained);
    });

    test(`sponsorship offer reports unavailable recovery without claiming payment uncertainty (${variant})`, async ({
      page,
      context
    }) => {
      await context.addInitScript(() => {
        const original = Storage.prototype.getItem;
        (
          window as unknown as { restoreCheckoutStorage: () => void }
        ).restoreCheckoutStorage = () => {
          Storage.prototype.getItem = original;
        };
        Storage.prototype.getItem = function (key) {
          if (key.startsWith('openg7.checkout'))
            throw new DOMException('Synthetic denied storage', 'SecurityError');
          return original.call(this, key);
        };
      });
      let reads = 0;
      let calls = 0;
      await context.route('**/api/sponsorship-offer?**', (route) => {
        reads++;
        return route.fulfill({ json: syntheticSponsorshipOffer(5000) });
      });
      await context.route('**/api/checkout-sessions', (route) => {
        calls++;
        return route.fulfill({ json: mockedResult });
      });
      await page.goto(path(english));
      await expect(offer(page).getByRole('alert')).toContainText(
        english
          ? 'Recovery cannot be read or retained'
          : 'La reprise ne peut pas être lue ou conservée'
      );
      await expect(submit(page)).toBeDisabled();
      expect(reads).toBe(0);
      expect(calls).toBe(0);
      await page.evaluate(() =>
        (
          window as unknown as { restoreCheckoutStorage: () => void }
        ).restoreCheckoutStorage()
      );
      await offer(page)
        .getByRole('button', {
          name: english ? 'Try again' : 'Réessayer',
          exact: true
        })
        .click();
      await expect(acceptance(page)).toBeVisible();
      await expect(acceptance(page)).not.toBeChecked();
      expect(reads).toBe(1);
      expect(calls).toBe(0);
    });

    test(`sponsorship offer prevents the first Checkout call when storing its public terms fails (${variant})`, async ({
      page,
      context
    }) => {
      await context.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === 'openg7.checkout-offer-recovery.v1')
            throw new DOMException('Synthetic quota', 'QuotaExceededError');
          return original.call(this, key, value);
        };
      });
      let calls = 0;
      await context.route('**/api/sponsorship-offer?**', (route) =>
        route.fulfill({ json: syntheticSponsorshipOffer(5000) })
      );
      await context.route('**/api/checkout-sessions', (route) => {
        calls++;
        return route.fulfill({ json: mockedResult });
      });
      await page.goto(path(english));
      await acknowledge(page, english);
      await acceptance(page).check();
      await submit(page).click();
      await expect(form(page).getByRole('alert')).toContainText(
        english
          ? 'Recovery cannot be read or retained'
          : 'La reprise ne peut pas être lue ou conservée'
      );
      expect(calls).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem('openg7.checkout-attempts.v2')
        )
      ).toBeNull();
      expect(
        await page.evaluate(() =>
          localStorage.getItem('openg7.checkout-verification-required.v1')
        )
      ).toBeNull();
    });
  });
}
