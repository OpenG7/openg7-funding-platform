import { test, expect } from './support/test.js';

for (const language of ['fr-CA', 'en'] as const) {
  for (const state of ['pending', 'failed', 'expired', 'paid'] as const) {
    test(`mobile checkout return uses server state ${state} (${language})`, async ({
      page
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      let paymentStatus: string = state;
      let checkouts = 0;
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/reference-lookup')) {
          await route.fulfill({ json: { found: true, paymentStatus } });
        } else if (path.endsWith('/checkout-sessions')) {
          checkouts++;
          await route.fulfill({ status: 503, json: {} });
        } else if (path.endsWith('/funding-config')) {
          await route.fulfill({ json: { business_sponsorship_enabled: true } });
        } else await route.fulfill({ status: 503, json: {} });
      });
      const prefix = language === 'en' ? '/en' : '';
      // A forged status hint must never override the server (including a paid
      // contribution revisited through an old cancellation URL).
      await page.goto(
        `${prefix}/fonds-des-batisseurs?checkout=cancel&reference=OG7-2026-FAIL1&paymentStatus=paid&intent=sponsorship`
      );
      const notice = page.locator('openg7-funding-checkout-notice');
      const titles =
        language === 'en'
          ? {
              pending: 'The chest remains closed for this contribution.',
              failed: 'Your payment attempt did not succeed.',
              expired: 'This checkout session has expired.',
              paid: 'The Builders’ chest has just received your contribution.'
            }
          : {
              pending: 'Le coffre reste fermé pour cette contribution.',
              failed: 'Votre tentative de paiement n’a pas abouti.',
              expired: 'Cette session de paiement a expiré.',
              paid: 'Le coffre des Bâtisseurs vient de recevoir votre contribution.'
            };
      if (state === 'paid') {
        await expect(notice.locator('#checkout-success-title')).toBeVisible();
        await expect(notice.locator('#checkout-cancel-title')).toHaveCount(0);
      } else {
        await expect(
          notice.getByRole('heading', { name: titles[state], exact: true })
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
        const verify = notice.getByRole('button', {
          name: language === 'en' ? 'Check again' : 'Vérifier à nouveau'
        });
        await expect(verify).toBeEnabled();
        paymentStatus = 'paid';
        await verify.focus();
        await page.keyboard.press('Enter');
        await expect(notice.locator('#checkout-success-title')).toBeVisible();
        await expect(notice.locator('#checkout-cancel-title')).toHaveCount(0);
      }
      expect(checkouts).toBe(0);
    });
  }
}
