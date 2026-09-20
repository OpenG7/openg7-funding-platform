import { AxeBuilder } from '@axe-core/playwright';

import {
  sponsorsResponse,
  sponsorProfile
} from '../fixtures/public-sponsors.mjs';

import { expect, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (r) => {
    const pathname = new URL(r.request().url()).pathname;
    if (pathname.endsWith('/funding-config'))
      await r.fulfill({
        json: {
          business_sponsorship_enabled: true,
          allowed_contribution_amounts: [5, 10, 25, 50]
        }
      });
    else if (pathname.endsWith('/builders'))
      await r.fulfill({
        json: {
          data_source: 'database',
          builders: [],
          last_updated_at: '2026-09-19T00:00:00Z',
          pagination: { page: 1, page_size: 12, total_count: 0 }
        }
      });
    else if (pathname.endsWith('/sponsorships'))
      await r.fulfill({ json: sponsorsResponse([sponsorProfile()], 1, 12) });
    else if (pathname.endsWith('/fund-transparency'))
      await r.fulfill({
        json: {
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
          last_updated_at: '2026-09-19T00:00:00Z'
        }
      });
    else if (pathname.endsWith('/sponsorship-batches/availability'))
      await r.fulfill({
        json: { data_source: 'empty', availability: [], slots: [] }
      });
    else if (
      pathname.endsWith('/reference-recovery') ||
      pathname.endsWith('/sponsorship-followup/recover')
    )
      await r.fulfill({ json: { accepted: true } });
    else await r.fulfill({ status: 503, json: {} });
  });
});

for (const prefix of ['', '/en']) {
  test(`support prioritizes contributor help and preserves recovery ${prefix || 'fr'}`, async ({
    page
  }) => {
    await page.goto(`${prefix}/support`);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const heroLink = page.getByRole('link', {
      name: prefix ? 'Find my contribution' : 'Retrouver ma contribution',
      exact: true
    });
    await heroLink.click();
    await expect(page.locator('#reference-lookup-input')).toBeFocused();
    await expect(page.locator('[data-og7="support-help"]')).toBeVisible();
    expect(
      await page
        .locator('[data-og7="support-help"]')
        .evaluate((node) =>
          Boolean(
            node.compareDocumentPosition(
              document.querySelector('#technical-participation')!
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          )
        )
    ).toBe(true);
    await expect(
      page.locator('[data-og7="sponsorship-help"] a')
    ).toHaveAttribute(
      'href',
      `${prefix}/fonds-des-batisseurs/suivi-commandite`
    );
    await expect(
      page.locator('[data-og7="contact-help"] a').first()
    ).toHaveAttribute('href', 'mailto:contact@openg7.org');
    await page.locator('[data-og7="reference-recovery"] summary').click();
    await page
      .locator('#reference-recovery-email')
      .fill('fixture@example.invalid');
    await page.locator('#reference-recovery-email').press('Enter');
    await expect(page.locator('#reference-recovery-status')).toContainText(
      prefix ? 'If a contribution matches' : 'Si une contribution correspond'
    );
    expect(errors).toEqual([]);
  });
  test(`business intent and pending payment remain safe ${prefix || 'fr'}`, async ({
    page
  }) => {
    let checkouts = 0;
    await page.route('**/checkout-sessions', (r) => {
      checkouts++;
      return r.fulfill({ status: 500, json: {} });
    });
    await page.goto(`${prefix}/commanditaires`);
    await page.locator('[data-og7="sponsors-become"]').click();
    await expect(page).toHaveURL(/intent=sponsorship#support/);
    await expect(
      page.getByRole('button', {
        name: prefix ? /Business sponsorship/ : /Commandite d'entreprise/
      })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(checkouts).toBe(0);
    await page.goto(`${prefix}/fonds-des-batisseurs?checkout=success`);
    await expect(
      page.getByText(prefix ? 'Payment received' : 'Paiement reçu', {
        exact: true
      })
    ).toHaveCount(0);
  });
  for (const route of ['/batisseurs', '/support']) {
    test(`accessible names, contrast and reflow ${prefix}${route}`, async ({
      page
    }, info) => {
      await page.goto(`${prefix}${route}`);
      if (route === '/batisseurs')
        await expect(page.locator('[data-og7="builders-empty"]')).toBeVisible();
      else await expect(page.locator('#reference-lookup-input')).toBeVisible();
      await page
        .locator(
          route === '/support'
            ? '[data-og7="support-help"]'
            : '[data-og7="builders-directory"]'
        )
        .screenshot({ path: info.outputPath('content.png'), scale: 'css' });
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      await info.attach('accessibility', {
        body: JSON.stringify(scan),
        contentType: 'application/json'
      });
      expect(
        scan.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target)
        }))
      ).toEqual([]);
      await page.setViewportSize({ width: 320, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth
        )
      ).toBeLessThanOrEqual(1);
      await page.setViewportSize({ width: 800, height: 900 });
      await page.addStyleTag({
        content: 'html { font-size: 200% !important; }'
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth
        )
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: info.outputPath('reflow.png'),
        fullPage: false,
        scale: 'css'
      });
    });
  }
}
