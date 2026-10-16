import type { AdminExpensesResponse } from '@openg7/funding-core';
import type { Locator, Page } from '@playwright/test';

import type { StripeSetupDevStatus } from '../../apps/funding-web/src/app/features/funding/services/stripe-setup-dev.service.js';

import { expect, test } from './support/test.js';

const palettes = {
  mineral: {
    panel: 'rgb(255, 255, 255)',
    raised: 'rgb(240, 244, 238)',
    text: 'rgb(41, 51, 46)'
  },
  night: {
    panel: 'rgb(20, 35, 56)',
    raised: 'rgb(27, 45, 68)',
    text: 'rgb(241, 245, 252)'
  },
  graphite: {
    panel: 'rgb(37, 41, 47)',
    raised: 'rgb(50, 56, 65)',
    text: 'rgb(243, 244, 246)'
  }
} as const;

const expenses: AdminExpensesResponse = {
  data_source: 'database',
  expenses: [
    {
      id: 'allocation-style-fixture',
      project_name: 'Synthetic style allocation',
      public_description: 'Synthetic public description',
      expected_outcome: 'Synthetic expected outcome',
      progress_status: 'planned',
      proof_url: null,
      proof_source: null,
      proof_published_at: null,
      amount_allocated: 125,
      currency: 'CAD',
      status: 'draft',
      published_at: null,
      created_at: '2026-10-02T12:00:00Z',
      updated_at: '2026-10-02T12:00:00Z'
    }
  ],
  summary: {
    total_count: 1,
    published_count: 0,
    draft_count: 1,
    private_count: 0,
    archived_count: 0,
    total_allocated: 125,
    published_allocated: 0,
    currency: 'CAD'
  },
  last_updated_at: '2026-10-02T12:00:00Z'
};

async function columns(grid: Locator): Promise<number> {
  return grid.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length
  );
}

async function adminFixture(page: Page) {
  const state = { authenticated: true, signIns: 0, writes: [] as string[] };
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      if (path.endsWith('/admin/session')) state.signIns++;
      else state.writes.push(path);
      return route.fulfill({ status: 401, json: {} });
    }
    if (path.endsWith('/auth/config'))
      return route.fulfill({
        json: { mode: state.authenticated ? 'oidc' : 'token' }
      });
    if (path.endsWith('/auth/current'))
      return route.fulfill(
        state.authenticated
          ? {
              json: {
                id: 'style-owner',
                sessionId: 'style-session',
                displayName: 'Synthetic style owner',
                role: 'owner',
                expiresAt: '2099-01-01T00:00:00Z'
              }
            }
          : { status: 401, json: {} }
      );
    if (path.endsWith('/admin/expenses'))
      return route.fulfill(
        state.authenticated ? { json: expenses } : { status: 401, json: {} }
      );
    return route.fulfill({ status: 503, json: {} });
  });
  return state;
}

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  for (const language of ['fr-CA', 'en'] as const) {
    test(`platform CSS preserves ${theme} login and expenses in ${language}`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width: english ? 1440 : 390, height: 1000 });
      await page.addInitScript(
        ({ theme, language }) => {
          localStorage.setItem('openg7.language', language);
          localStorage.setItem(
            'openg7.pilotage.appearance.v1',
            JSON.stringify({ theme, system: false, density: 'comfortable' })
          );
        },
        { theme, language }
      );
      const state = await adminFixture(page);
      await page.goto('/admin/fundraiser/expenses');
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        theme
      );
      const create = page.locator('[data-og7="allocation-create"]');
      const card = page.locator('[data-og7="allocation-card"]');
      const filters = page.locator('[data-og7="allocation-filters"]');
      const summary = page.getByRole('region', {
        name: english ? 'Expense summary' : 'Resume depenses',
        exact: true
      });
      for (const panel of [create, card, filters]) {
        await expect(panel).toHaveCSS('display', 'grid');
        await expect(panel).toHaveCSS(
          'background-color',
          palettes[theme].panel
        );
        await expect(panel).toHaveCSS('padding', '16px');
        await expect(panel).toHaveCSS('border-radius', '7.2px');
      }
      await expect(summary).toHaveCSS('gap', '12px');
      await expect.poll(() => columns(summary)).toBe(english ? 4 : 1);
      await expect(card.getByRole('textbox').first()).toHaveCSS(
        'color',
        palettes[theme].text
      );
      await expect(card.locator('textarea').first()).toHaveCSS(
        'resize',
        'vertical'
      );
      const search = filters.getByRole('searchbox');
      await search.fill('missing synthetic allocation');
      await expect(card).toHaveCount(0);
      await search.fill('Synthetic style');
      await expect(card).toHaveCount(1);
      if (theme === 'mineral' && !english) {
        const fields = create
          .getByRole('spinbutton')
          .locator('..')
          .locator('..');
        for (const width of [900, 901]) {
          await test.step(`expense CSS boundary ${width}px`, async () => {
            await page.setViewportSize({ width, height: 1000 });
            for (const [grid, count] of [
              [summary, width <= 900 ? 1 : 4],
              [filters, width <= 900 ? 1 : 2],
              [fields, width <= 900 ? 1 : 3]
            ] as const) {
              await expect.poll(() => columns(grid)).toBe(count);
            }
          });
        }
        await page.setViewportSize({ width: 390, height: 1000 });
      }
      expect(state.writes).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      // A real session-expiration navigation keeps the appearance service and
      // its inherited palette alive on the login page.
      state.authenticated = false;
      await page
        .getByRole('heading', { level: 1 })
        .locator('..')
        .locator('..')
        .getByRole('button')
        .click();
      await expect(page).toHaveURL(/\/admin\/login\?/);
      await expect(card).toHaveCount(0);
      const login = page.getByRole('region', {
        name: english ? 'Admin access' : 'Acces admin',
        exact: true
      });
      const token = login.locator('input[type="password"]');
      await expect(token).toBeVisible();
      await expect(login).toHaveCSS('display', 'grid');
      await expect(login).toHaveCSS('gap', '16px');
      await expect(login).toHaveCSS('max-width', '448px');
      await expect(login).toHaveCSS('background-color', palettes[theme].panel);
      await expect(token).toHaveCSS('font-weight', '400');
      await token.fill('synthetic-invalid-token');
      await page.keyboard.press('Tab');
      const submit = login.locator('button[type="submit"]');
      await expect(submit).toBeFocused();
      await expect(submit).toHaveCSS('outline-width', '3px');
      await page.keyboard.press('Enter');
      await expect(login.getByRole('alert')).toHaveCSS(
        'background-color',
        palettes[theme].raised
      );
      expect(state.signIns).toBe(1);
      expect(state.writes).toEqual([]);
    });
  }
}

// Same synthetic public diagnostic contract as dev-tools-pages.spec.ts. All
// requests are intercepted; no dashboard link or provider command is invoked.
const readyStatus: StripeSetupDevStatus = {
  environment: 'development-fixture',
  apiReachable: true,
  stripeSecretKeyConfigured: true,
  stripeWebhookSecretConfigured: true,
  databaseUrlConfigured: true,
  databaseReachable: true,
  transparencySource: 'database',
  localApiBaseUrl: 'http://127.0.0.1:3333',
  checkoutEndpoint: 'http://127.0.0.1:3333/api/checkout-sessions',
  webhookEndpoint: 'http://127.0.0.1:3333/api/stripe/webhook',
  publicTransparencyEndpoint:
    'http://127.0.0.1:3333/api/public/fund-transparency',
  stripeDashboardUrl: 'https://dashboard.stripe.com/test/webhooks',
  lastCheckedAt: '2026-10-03T12:00:00Z'
};

const heroBackground =
  'linear-gradient(90deg, var(--surface-page) 0%, color-mix(in srgb, var(--surface-page) 97%, transparent) 38%, color-mix(in srgb, var(--surface-page) 90%, transparent) 68%, color-mix(in srgb, var(--surface-page) 25%, transparent)), linear-gradient(180deg, transparent 60%, var(--surface-page))';

async function backgroundComparison(
  element: Locator,
  expression: string,
  pseudo: '::after' | null
) {
  return element.evaluate(
    (node, { expression, pseudo }) => {
      const probe = document.createElement('span');
      probe.style.cssText = 'display:none';
      probe.style.background = expression;
      node.append(probe);
      try {
        const actual = getComputedStyle(node, pseudo);
        const expected = getComputedStyle(probe);
        return {
          supported: CSS.supports('color', 'color-mix(in lab, red, red)'),
          actual: [actual.backgroundImage, actual.backgroundColor],
          expected: [expected.backgroundImage, expected.backgroundColor]
        };
      } finally {
        probe.remove();
      }
    },
    { expression, pseudo }
  );
}

for (const mobile of [true, false]) {
  test(`platform CSS preserves diagnostic grids and color-mix on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page
  }) => {
    const writes: string[] = [];
    await page.route('**/api/**', (route) => {
      if (route.request().method() !== 'GET')
        writes.push(route.request().url());
      return route.fulfill({
        status: route.request().url().endsWith('/dev/stripe-setup-status')
          ? 200
          : 503,
        json: readyStatus
      });
    });
    for (const diagnostic of [
      {
        path: '/dev/api-keys',
        region: 'Etat des cles Stripe',
        focusWidth: '2px'
      },
      {
        path: '/dev/webhooks',
        region: 'Statut Webhooks',
        focusWidth: '3px'
      },
      {
        path: '/dev/stripe-setup',
        region: 'Statuts Stripe',
        focusWidth: '2px'
      }
    ]) {
      await test.step(diagnostic.path, async () => {
        await page.setViewportSize({
          width: mobile ? 390 : 1440,
          height: 1000
        });
        await page.goto(diagnostic.path);
        const hero = page.getByRole('region', {
          name: diagnostic.path,
          exact: true
        });
        const comparison = await backgroundComparison(
          hero,
          heroBackground,
          '::after'
        );
        expect(comparison.supported).toBe(true);
        expect(comparison.actual).toEqual(comparison.expected);
        expect(comparison.actual[0]).not.toBe('none');
        const grid = page.getByRole('region', {
          name: diagnostic.region,
          exact: true
        });
        const stripe = diagnostic.path === '/dev/stripe-setup';
        await expect(grid).toHaveCSS('display', 'grid');
        await expect
          .poll(() => columns(grid))
          .toBe(mobile ? 1 : stripe ? 2 : 4);
        await expect(grid.getByRole('article').first()).toHaveCSS(
          'background-color',
          'rgb(255, 255, 255)'
        );
        if (stripe) {
          const danger = page.locator('[data-og7="stripe-setup-refresh"]');
          const comparison = await backgroundComparison(
            danger,
            'color-mix(in srgb, var(--color-danger) 8%, var(--surface-panel))',
            null
          );
          expect(comparison.supported).toBe(true);
          expect(comparison.actual).toEqual(comparison.expected);
          const progress = page.getByRole('list', {
            name: 'Progression Stripe Setup'
          });
          await expect.poll(() => columns(progress)).toBe(mobile ? 1 : 3);
        }
        const home = page.getByRole('link', { name: 'Accueil OpenG7' });
        await page.keyboard.press('Tab');
        await home.focus();
        await expect(home).toBeFocused();
        await expect(home).toHaveCSS('outline-width', diagnostic.focusWidth);
        await expect(home).toHaveCSS('outline-style', 'solid');
        await expect(home).toHaveCSS('outline-offset', '3px');
        await expect(home).toHaveCSS('outline-color', 'rgb(47, 107, 80)');
        if (!mobile) {
          const widths = stripe
            ? [760, 761, 1100, 1101]
            : [900, 901, 1200, 1201];
          for (const width of widths) {
            await page.setViewportSize({ width, height: 1000 });
            await expect
              .poll(() => columns(grid))
              .toBe(
                stripe
                  ? width <= 1100
                    ? 1
                    : 2
                  : width <= 900
                    ? 1
                    : width <= 1200
                      ? 2
                      : 4
              );
            if (stripe) {
              await expect
                .poll(() =>
                  columns(page.getByRole('group', { name: 'Mode Stripe' }))
                )
                .toBe(width <= 760 ? 1 : 2);
            }
          }
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
      });
    }
    expect(writes).toEqual([]);
  });
}
