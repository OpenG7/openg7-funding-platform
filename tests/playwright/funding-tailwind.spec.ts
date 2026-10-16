import type { Locator, Page } from '@playwright/test';

import { expect, test } from './support/test.js';

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
  last_updated_at: '2026-10-16T12:00:00Z'
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/funding-config'))
      await route.fulfill({ json: { business_sponsorship_enabled: false } });
    else if (pathname.endsWith('/fund-transparency'))
      await route.fulfill({ json: emptyReport });
    else if (pathname.endsWith('/sponsorship-charter'))
      await route.fulfill({
        json: {
          active: false,
          policyVersion: '1.0',
          fingerprint: null,
          text: null
        }
      });
    else await route.fulfill({ status: 503, json: {} });
  });
});

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  ).toBe(true);
}

// Compare against the original expression in the same inherited public theme.
// This detects an opaque compatibility fallback winning over the modern branch.
async function expectOriginalGradient(overlay: Locator, mobile: boolean) {
  const backgrounds = await overlay.evaluate((element, narrow) => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.background = narrow
      ? `linear-gradient(
          color-mix(in srgb, var(--surface-page) 94%, transparent),
          color-mix(in srgb, var(--surface-page) 98%, transparent)
        )`
      : `linear-gradient(
          90deg,
          var(--surface-page) 0%,
          color-mix(in srgb, var(--surface-page) 97%, transparent) 38%,
          color-mix(in srgb, var(--surface-page) 90%, transparent) 68%,
          color-mix(in srgb, var(--surface-page) 25%, transparent)
        ), linear-gradient(180deg, transparent 60%, var(--surface-page))`;
    element.parentElement!.appendChild(probe);
    const result = {
      supported: CSS.supports('color', 'color-mix(in srgb, red, transparent)'),
      expected: getComputedStyle(probe).backgroundImage,
      actual: getComputedStyle(element).backgroundImage
    };
    probe.remove();
    return result;
  }, mobile);
  expect(backgrounds.supported).toBe(true);
  expect(backgrounds.expected).not.toBe('none');
  expect(backgrounds.actual).toBe(backgrounds.expected);
}

const surfaces = [
  { path: '/fonds-des-batisseurs', title: 'builders-title', breakpoint: 860 },
  { path: '/ecosystem', title: 'ecosystem-title', breakpoint: 860 },
  { path: '/boutique', title: 'boutique-title', breakpoint: 760 },
  { path: '/music', title: 'music-title', breakpoint: 720 }
] as const;

for (const prefix of ['', '/en']) {
  for (const surface of surfaces) {
    test(`public styles preserve gradients and shared keyboard navigation ${surface.path} ${prefix || 'fr'}`, async ({
      page
    }) => {
      const errors: string[] = [];
      const mutations: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (request.url().includes('/api/') && request.method() !== 'GET')
          mutations.push(request.method());
      });
      await page.goto(prefix + surface.path, {
        waitUntil: 'domcontentloaded'
      });
      await expect(page.locator(`#${surface.title}`)).toBeVisible();

      const hero = page.locator(`section[aria-labelledby="${surface.title}"]`);
      const overlay = hero.locator(':scope > div[aria-hidden="true"]');
      for (const width of [390, 1280]) {
        await test.step(`${width}px public palette and original gradient`, async () => {
          await page.setViewportSize({ width, height: 900 });
          await expect(page.locator('main')).toHaveCSS(
            'background-color',
            'rgb(247, 245, 240)'
          );
          await expect(page.locator('main')).toHaveCSS(
            'color',
            'rgb(41, 51, 46)'
          );
          await expect(hero).toHaveCSS('position', 'relative');
          await expect(hero).toHaveCSS('overflow', 'hidden');
          await expectOriginalGradient(overlay, width <= surface.breakpoint);
          await expectNoOverflow(page);
        });
      }

      const language = page.getByRole('button', {
        name: prefix
          ? 'Changer la langue du site vers le français'
          : 'Switch site language to English',
        exact: true
      });
      await page.keyboard.press('Tab');
      await language.focus();
      await expect(language).toHaveCSS('min-height', '44px');
      await expect(language).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)'
      );
      await expect(language).toHaveCSS('border-radius', '999px');
      await expect(language).toHaveCSS('outline-width', '3px');
      await expect(language).toHaveCSS('outline-color', 'rgb(47, 107, 80)');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        (url) => url.pathname === (prefix ? '' : '/en') + surface.path
      );
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test(`boutique grid and product cards preserve responsive boundaries ${prefix || 'fr'}`, async ({
    page
  }) => {
    await page.goto(prefix + '/boutique', {
      waitUntil: 'domcontentloaded'
    });
    const grid = page.locator('#featured-grid');
    const card = page.locator('[data-og7="boutique-product"]').first();
    await expect(card).toBeVisible();
    await expect(grid).toHaveCSS('gap', '24px');
    await expect(card).toHaveCSS('border-radius', '12px');
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    for (const width of [519, 520, 521, 1159, 1160, 1161]) {
      await page.setViewportSize({ width, height: 900 });
      const expectedColumns = width <= 520 ? 1 : width <= 1160 ? 2 : 3;
      expect(
        await grid.evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(' ').length
        )
      ).toBe(expectedColumns);
      await expectNoOverflow(page);
    }
    const filter = page
      .locator('[data-og7="boutique-universes"]')
      .getByRole('button', { name: 'Dragons', exact: true });
    await filter.focus();
    await page.keyboard.press('Space');
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(filter).toBeFocused();
    await expect(filter).toHaveCSS('outline-width', '3px');
    await expect(page.locator('[data-og7="boutique-product"]')).not.toHaveCount(
      0
    );
  });
}
