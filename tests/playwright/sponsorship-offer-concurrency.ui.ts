import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { CheckoutRequest } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { syntheticSponsorshipOffer } from './support/sponsorship-offer-fixture.js';

interface CheckoutLockFixture {
  held: boolean;
  release?: () => void;
  task: Promise<void>;
}

/** Real origin locks and two browser services; only public API responses are synthetic. */
export function registerSponsorshipOfferConcurrencyTests(ports: {
  setup(context: BrowserContext): Promise<void>;
  prepare(page: Page, english: boolean): Promise<void>;
  submit(page: Page): Locator;
}): void {
  for (const english of [false, true]) {
    const variant = english ? 'EN mobile' : 'FR desktop';
    test(
      'sponsorship submissions across tabs preserve the uncertain Checkout key (' +
        variant +
        ')',
      async ({ page, context }) => {
        await ports.setup(context);
        const quoted = syntheticSponsorshipOffer(5000);
        const requests: CheckoutRequest[] = [];
        let releaseResponses!: () => void;
        const responses = new Promise<void>((resolve) => {
          releaseResponses = resolve;
        });
        await context.route('**/api/sponsorship-offer?**', (route) =>
          route.fulfill({ json: quoted })
        );
        await context.route('**/api/checkout-sessions', async (route) => {
          requests.push(route.request().postDataJSON() as CheckoutRequest);
          const dispatch = requests.length;
          if (dispatch <= 2) {
            await responses;
            return dispatch === 1
              ? route.abort('failed')
              : route.fulfill({
                  status: 409,
                  json: { code: 'SPONSORSHIP_OFFER_CHANGED' }
                });
          }
          return route.fulfill({
            json: {
              status: 'mocked',
              checkoutId: 'synthetic-concurrent-checkout',
              redirectUrl: 'https://example.test/unused'
            }
          });
        });
        const other = await context.newPage();
        const pages = [page, other];
        for (const tab of pages) {
          await tab.setViewportSize(
            english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
          );
          await ports.prepare(tab, english);
        }
        const lockName = 'openg7.checkout-attempts.v2';
        await page.evaluate((name) => {
          const state = { held: false } as CheckoutLockFixture;
          (
            window as unknown as { checkoutLockFixture: CheckoutLockFixture }
          ).checkoutLockFixture = state;
          state.task = navigator.locks
            .request(name, async () => {
              state.held = true;
              await new Promise<void>((resolve) => {
                state.release = resolve;
              });
              state.held = false;
            })
            .then(() => undefined);
        }, lockName);
        try {
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  (
                    window as unknown as {
                      checkoutLockFixture: CheckoutLockFixture;
                    }
                  ).checkoutLockFixture.held
              )
            )
            .toBe(true);
          await Promise.all(pages.map((tab) => ports.submit(tab).click()));
          await expect
            .poll(() =>
              page.evaluate(async (name) => {
                const snapshot = await navigator.locks.query();
                return (
                  snapshot.pending?.filter((lock) => lock.name === name)
                    .length ?? 0
                );
              }, lockName)
            )
            .toBeGreaterThanOrEqual(2);
          expect(requests).toHaveLength(0);
          await page.evaluate(async () => {
            const state = (
              window as unknown as { checkoutLockFixture: CheckoutLockFixture }
            ).checkoutLockFixture;
            state.release?.();
            await state.task;
          });
          // Both requests reach the adapter before either response completes:
          // coordinating browser recovery does not hold the lock during the API call.
          await expect.poll(() => requests.length).toBe(2);
          expect(requests[1]).toEqual(requests[0]);
          releaseResponses();
          for (const tab of pages)
            await expect(
              tab.locator('[data-og7="contribution-form"]').getByRole('alert')
            ).toBeVisible();
          const retained = await page.evaluate(() => ({
            attempts: localStorage.getItem('openg7.checkout-attempts.v2'),
            offer: localStorage.getItem('openg7.checkout-offer-recovery.v1')
          }));
          expect(retained.attempts).not.toBeNull();
          expect(retained.offer).not.toBeNull();
          expect(Object.values(JSON.parse(retained.attempts!))).toEqual([
            expect.objectContaining({
              idempotencyKey: requests[0].idempotencyKey
            })
          ]);
          await Promise.all(pages.map((tab) => tab.close()));
          const reopened = await context.newPage();
          await reopened.goto(
            (english ? '/en' : '') + '/fonds-des-batisseurs?intent=sponsorship'
          );
          const form = reopened.locator('[data-og7="contribution-form"]');
          const offer = form.locator('[data-og7="sponsorship-offer"]');
          await expect(offer).toContainText(
            english
              ? 'originally confirmed offer is retained'
              : 'offre initialement confirmée est conservée'
          );
          await form
            .getByLabel(
              english
                ? /OpenG7 is an independent project/
                : /OpenG7 est un projet indépendant/
            )
            .check();
          await form.locator('[data-og7="offer-acceptance"]').check();
          await ports.submit(reopened).click();
          await expect.poll(() => requests.length).toBe(3);
          expect(requests[2]).toEqual(requests[0]);
          await expect
            .poll(() =>
              reopened.evaluate(() => ({
                attempts: localStorage.getItem('openg7.checkout-attempts.v2'),
                offer: localStorage.getItem('openg7.checkout-offer-recovery.v1')
              }))
            )
            .toEqual({ attempts: null, offer: null });
        } finally {
          releaseResponses();
          if (!page.isClosed())
            await page.evaluate(async () => {
              const state = (
                window as unknown as {
                  checkoutLockFixture?: CheckoutLockFixture;
                }
              ).checkoutLockFixture;
              state?.release?.();
              await state?.task;
            });
        }
      }
    );
  }
}
