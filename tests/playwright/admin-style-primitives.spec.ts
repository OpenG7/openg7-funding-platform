import type { Locator, Page } from '@playwright/test';
import type {
  AdminContributionRecord,
  AdminDashboardResponse
} from '@openg7/funding-core';

import { cockpitFixtures } from './support/cockpit-fixtures.js';
import { expect, test } from './support/test.js';

const palettes = {
  mineral: {
    neutral: ['#52627b', '#f5f7fb'],
    success: ['#236342', '#eaf6ee'],
    warning: ['#805411', '#fff4d6'],
    danger: ['#a52d3e', '#fcecef'],
    blue: ['#245b94', '#e7f2ff']
  },
  night: {
    neutral: ['#bdcbe0', '#102033'],
    success: ['#a1e7b1', '#163c2e'],
    warning: ['#ffda85', '#3b3020'],
    danger: ['#ffb5bc', '#402630'],
    blue: ['#9edaff', '#243d53']
  },
  graphite: {
    neutral: ['#c4cbd5', '#202429'],
    success: ['#a7dfbc', '#263c32'],
    warning: ['#f5d494', '#413725'],
    danger: ['#ffbcc9', '#462c35'],
    blue: ['#b0d2eb', '#38434f']
  }
} as const;

type Theme = keyof typeof palettes;
type Language = 'fr-CA' | 'en';

function rgb(hex: string): string {
  const channels = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16)
  );
  return `rgb(${channels.join(', ')})`;
}

async function expectPalette(
  element: Locator,
  [foreground, background]: readonly [string, string]
) {
  await expect(element).toHaveCSS('color', rgb(foreground));
  await expect(element).toHaveCSS('background-color', rgb(background));
}

async function fixtures(page: Page, theme: Theme, language: Language) {
  const data = cockpitFixtures();
  const date = data.metrics.generatedAt;
  const contribution: AdminContributionRecord = {
    id: 'style-paid-fixture',
    public_reference: 'STYLE-PAID',
    contribution_type: 'personal_support',
    amount: 2500,
    currency: 'CAD',
    payment_status: 'paid',
    paid_at: date,
    public_name: 'Style fixture paid',
    email_private: null,
    public_display_consent: false,
    display_amount_consent: false,
    non_charity_acknowledged: true,
    sponsor_company_name: null,
    sponsor_contact_name: null,
    sponsor_contact_email: null,
    sponsor_review_status: null,
    sponsor_feed_status: null,
    stripe_session_id: null,
    stripe_payment_intent_id: null,
    created_at: date,
    updated_at: date
  };
  // Synthetic presentation data only; no payment or provider is exercised.
  const dashboard: AdminDashboardResponse = {
    data_source: 'database',
    data_available: true,
    totals: {
      total_received: 3500,
      total_refunded: 1000,
      total_disputed: 0,
      current_available_estimate: 2500,
      currency: 'CAD',
      contributions_count: 2,
      paid_contributions_count: 1
    },
    sponsorship_review: { total: 3, pending: 1, approved: 2, rejected: 0 },
    feed_publication: { planned: 1, drafted: 0, published: 0, active: 0 },
    stripe_events: { failed: 1, processing: 0, last_failed_at: date },
    recent_contributions: [
      contribution,
      {
        ...contribution,
        id: 'style-refunded-fixture',
        public_reference: 'STYLE-REFUNDED',
        public_name: 'Style fixture refunded',
        amount: 1000,
        payment_status: 'refunded'
      }
    ],
    last_updated_at: date
  };
  const mutations: string[] = [];
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
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      mutations.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 405, json: {} });
    }
    if (path === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (path === '/api/admin/auth/current')
      return route.fulfill({
        json: {
          id: 'style-owner-fixture',
          sessionId: 'style-session-fixture',
          displayName: 'Style owner fixture',
          role: 'owner',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (path === '/api/admin/dashboard')
      return route.fulfill({ json: dashboard });
    if (path.startsWith('/api/admin/cockpit/')) {
      const block = path.split('/').pop() as keyof typeof data;
      if (Object.hasOwn(data, block))
        return route.fulfill({ json: data[block] });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return mutations;
}

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  for (const { language, width, sponsors } of [
    { language: 'fr-CA', width: 390, sponsors: 'Commandites' },
    { language: 'en', width: 1280, sponsors: 'Sponsorships' }
  ] as const) {
    test(`admin primitives retain dimensions and ${theme} colors in ${language} at ${width}px`, async ({
      page
    }) => {
      const mutations = await fixtures(page, theme, language);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/admin/fundraiser');
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        theme
      );

      const dashboard = page.locator('[data-og7="admin-dashboard"]');
      for (const tone of ['neutral', 'success', 'warning', 'danger'] as const) {
        const badge = dashboard
          .locator(`[data-og7="admin-badge"][data-tone="${tone}"]`)
          .first();
        await expect(badge).toBeVisible();
        await expectPalette(badge, palettes[theme][tone]);
        await expect(badge).toHaveCSS('font-size', '14px');
        await expect(badge).toHaveCSS('font-weight', '600');
        await expect(badge).toHaveCSS('padding-top', '4px');
        await expect(badge).toHaveCSS('padding-bottom', '4px');
        await expect(badge).toHaveCSS('padding-left', '9.6px');
        await expect(badge).toHaveCSS('padding-right', '9.6px');
        await expect(badge).toHaveCSS('border-top-width', '1px');
        await expect(badge).toHaveCSS('border-top-style', 'solid');
        await expect(badge).toHaveCSS('border-radius', '10px');
      }

      // All current metric consumers use embedded=true; cover their real grid.
      const metrics = dashboard.locator('[data-og7="admin-metric"]');
      await expect(metrics).toHaveCount(4);
      const sponsorships = dashboard.getByRole('article', {
        name: sponsors,
        exact: true
      });
      await expect(sponsorships).toContainText('48');
      for (const metric of await metrics.all()) {
        await expect(metric).toHaveCSS('display', 'grid');
        await expect(metric).toHaveCSS('gap', '12px');
        await expect(metric).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(metric).toHaveCSS('background-image', 'none');
        await expect(metric).toHaveCSS('border-top-width', '0px');
        await expect(metric).toHaveCSS('border-radius', '0px');
        await expect(metric).toHaveCSS('padding-top', '20px');
        await expect(metric).toHaveCSS('padding-bottom', '16px');
        const value = metric.locator('strong');
        await expect(value).toHaveCSS('font-variant-numeric', 'tabular-nums');
        await expect(value).toHaveCSS('grid-column', '1 / -1');
      }
      for (const [tone, palette] of [
        ['blue', palettes[theme].blue],
        ['green', palettes[theme].success],
        ['gold', palettes[theme].warning]
      ] as const) {
        const icon = metrics.locator(`[data-tone="${tone}"]`).first();
        await expectPalette(icon, palette);
        // A direct grid item blockifies its authored inline-flex display.
        await expect(icon).toHaveCSS('display', 'flex');
        await expect(icon).toHaveCSS('width', '40px');
        await expect(icon).toHaveCSS('height', '40px');
      }

      // A different tab can change the inherited tokens after CSS compilation.
      const nextTheme = {
        mineral: 'night',
        night: 'graphite',
        graphite: 'mineral'
      }[theme] as Theme;
      await page.evaluate((nextTheme) => {
        const key = 'openg7.pilotage.appearance.v1';
        const oldValue = localStorage.getItem(key);
        const newValue = JSON.stringify({
          theme: nextTheme,
          system: false,
          density: 'comfortable'
        });
        localStorage.setItem(key, newValue);
        window.dispatchEvent(
          new StorageEvent('storage', {
            key,
            oldValue,
            newValue,
            storageArea: localStorage
          })
        );
      }, nextTheme);
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        nextTheme
      );
      for (const tone of ['neutral', 'success', 'warning', 'danger'] as const)
        await expectPalette(
          dashboard
            .locator(`[data-og7="admin-badge"][data-tone="${tone}"]`)
            .first(),
          palettes[nextTheme][tone]
        );
      await expectPalette(
        metrics.locator('[data-tone="green"]').first(),
        palettes[nextTheme].success
      );
      await expect(sponsorships).toContainText('48');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(mutations).toEqual([]);
    });
  }
}
