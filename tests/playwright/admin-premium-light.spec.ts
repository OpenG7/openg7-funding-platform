import { AxeBuilder } from '@axe-core/playwright';
import type { AdminDashboardResponse } from '@openg7/funding-core';
import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';
import {
  controllerJourneysFixtures,
  controllerPath
} from './support/controller-journeys.fixtures.js';

const appearanceKey = 'openg7.pilotage.appearance.v1';

async function premiumFixtures(page: Page, language: string) {
  const state = await controllerJourneysFixtures(page, 'owner', language, {
    hardware: 'native'
  });
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('premium-appearance-seeded')) {
      localStorage.setItem(
        key,
        JSON.stringify({
          theme: 'mineral',
          system: false,
          density: 'comfortable'
        })
      );
      sessionStorage.setItem('premium-appearance-seeded', 'true');
    }
  }, appearanceKey);
  const cockpit = cockpitFixtures();
  const dashboard: AdminDashboardResponse = {
    data_source: 'database',
    data_available: true,
    totals: {
      total_received: 500,
      total_refunded: 0,
      total_disputed: 0,
      current_available_estimate: 500,
      currency: 'CAD',
      contributions_count: 1,
      paid_contributions_count: 1
    },
    sponsorship_review: { total: 1, pending: 1, approved: 0, rejected: 0 },
    feed_publication: { planned: 0, drafted: 0, published: 0, active: 0 },
    stripe_events: {
      failed: 1,
      processing: 0,
      last_failed_at: cockpit.metrics.generatedAt
    },
    recent_contributions: [],
    last_updated_at: cockpit.metrics.generatedAt
  };
  const gate = { next: null as Promise<void> | null };
  await page.route('**/api/admin/dashboard', async (route) => {
    await gate.next;
    return route.fulfill({ json: dashboard });
  });
  await page.route('**/api/admin/cockpit/*', (route) => {
    const block = new URL(route.request().url()).pathname.split('/').pop();
    return block && Object.hasOwn(cockpit, block)
      ? route.fulfill({ json: cockpit[block as keyof typeof cockpit] })
      : route.fulfill({ status: 503, json: {} });
  });
  const writes: string[] = [];
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push(route.request().url());
    return route.fulfill({ status: 405, json: {} });
  });
  return { state, gate, writes };
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const viewport of [
    { width: 390, height: 1000 },
    // A 1920x1080 display at 125% supplies 1536x864 CSS pixels.
    { width: 1536, height: 864 }
  ]) {
    test(`Premium Light preserves contrast and controls in ${language} at ${viewport.width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const { state, gate, writes } = await premiumFixtures(page, language);
      await page.goto('/admin/fundraiser');
      const shell = page.locator('openg7-admin-layout');
      const dashboard = page.locator('[data-og7="admin-dashboard"]');
      const refresh = dashboard.locator('[data-og7="dashboard-refresh"]');
      await expect(refresh).toBeEnabled();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        'mineral'
      );
      await expect(shell).toHaveCSS('background-color', 'rgb(245, 247, 251)');
      await expect(shell).toHaveCSS('color', 'rgb(23, 43, 80)');
      await expect(shell).toHaveCSS('line-height', '24.8px');
      const heading = dashboard.getByRole('heading', { level: 1 });
      const title = await heading.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          size: Number.parseFloat(style.fontSize),
          tracking: Number.parseFloat(style.letterSpacing)
        };
      });
      expect(title.size).toBeGreaterThanOrEqual(26);
      expect(title.size).toBeLessThanOrEqual(32);
      expect(title.tracking).toBeCloseTo(title.size * -0.025, 3);
      const summaries = dashboard.getByRole('region', {
        name:
          language === 'en' ? 'Operations summary' : 'Synthèse des opérations'
      });
      const panel = summaries.getByRole('article').first();
      await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(panel).toHaveCSS('background-image', 'none');
      await expect(panel).toHaveCSS('border-color', 'rgb(216, 224, 236)');
      await expect(panel).toHaveCSS('border-radius', '14px');
      await expect(panel.locator('header')).toHaveCSS('padding', '20px');
      await expect(refresh).toHaveCSS('border-radius', '10px');
      await expect(refresh).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      if (viewport.width === 1536) {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await expect(refresh).toHaveCSS('transition-duration', /0\.16s/);
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
      await refresh.hover();
      await expect(refresh).toHaveCSS('background-color', 'rgb(240, 244, 249)');
      await page.keyboard.press('Tab');
      await refresh.focus();
      await expect(refresh).toBeFocused();
      await expect(refresh).toHaveCSS('outline-width', '3px');
      await expect(refresh).toHaveCSS('outline-style', 'solid');
      await expect(refresh).toHaveCSS('outline-color', 'rgb(18, 101, 176)');
      await expect(refresh).toHaveCSS('outline-offset', '3px');
      expect(
        await refresh.evaluate((element) =>
          getComputedStyle(element)
            .transitionDuration.split(',')
            .every((duration) => Number.parseFloat(duration) <= 0.00001)
        )
      ).toBe(true);

      let release!: () => void;
      gate.next = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await refresh.click();
        await expect(refresh).toBeDisabled();
        await refresh.hover({ force: true });
        await expect(refresh).toHaveCSS('cursor', 'not-allowed');
        await expect(refresh).toHaveCSS(
          'background-color',
          'rgb(240, 244, 249)'
        );
        await expect(refresh).toHaveCSS('color', 'rgb(82, 98, 123)');
        await expect(refresh).toHaveCSS('opacity', '0.65');
        await expect(refresh).toHaveCSS('box-shadow', 'none');
      } finally {
        gate.next = null;
        release();
      }
      await expect(refresh).toBeEnabled();
      const dashboardContrast = await new AxeBuilder({ page })
        .include('[data-og7="admin-dashboard"]')
        .withRules(['color-contrast'])
        .analyze();
      expect(dashboardContrast.violations).toEqual([]);
      expect(
        dashboardContrast.passes.some((rule) => rule.id === 'color-contrast')
      ).toBe(true);
      await page.mouse.move(0, 0);
      await heading.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`premium-dashboard-${viewport.width}.png`),
        animations: 'disabled'
      });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        'mineral'
      );
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).theme,
          appearanceKey
        )
      ).toBe('mineral');

      await page.goto(controllerPath('identity'));
      const dossier = page.locator('[data-og7="sponsorship-dossier"]');
      await expect(
        dossier.getByRole('heading', { name: 'Xbox fixture', exact: true })
      ).toBeVisible();
      await expect(dossier).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(dossier).toHaveCSS('border-radius', '14px');
      const moderationSelect = dossier
        .locator('[data-og7="moderation-actions"]')
        .getByRole('combobox')
        .first();
      await expect(moderationSelect).toHaveCSS('min-height', '44px');
      await expect(moderationSelect).toHaveCSS('padding', '10px 12px');
      await expect(moderationSelect).toHaveCSS('border-radius', '10px');
      await page.keyboard.press('Tab');
      await moderationSelect.focus();
      await expect(moderationSelect).toHaveCSS(
        'outline',
        'rgb(18, 101, 176) solid 3px'
      );
      const tabs = page.locator('[data-og7="dossier-tabs"]');
      await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
      const activeNavigation = page.locator(
        '#admin-sidebar nav a[aria-current="page"]'
      );
      await expect(activeNavigation).toHaveCSS(
        'background-color',
        'rgb(231, 242, 255)'
      );
      await expect(activeNavigation).toHaveCSS('color', 'rgb(36, 91, 148)');
      const opener = page.locator('[data-og7="edit-dossier"]');
      await opener.focus();
      await page.keyboard.press('Enter');
      const form = page.locator('[data-og7="edit-dossier-form"]');
      const company = form.locator('input[name="companyName"]');
      const save = form.locator('button[type="submit"]');
      await expect(save).toBeDisabled();
      await expect(save).toHaveCSS('background-color', 'rgb(240, 244, 249)');
      await company.fill('Synthetic unsaved premium draft');
      await expect(save).toBeEnabled();
      await expect(save).toHaveCSS('background-color', 'rgb(235, 193, 79)');
      await expect(save).toHaveCSS('background-image', 'none');
      await expect(save).toHaveCSS('color', 'rgb(37, 34, 15)');
      await save.hover();
      await expect(save).toHaveCSS('background-color', 'rgb(235, 193, 79)');
      await expect(save).toHaveCSS('color', 'rgb(37, 34, 15)');
      await page.keyboard.press('Tab');
      await company.focus();
      await expect(company).toHaveCSS('outline-width', '3px');
      await expect(company).toHaveCSS('outline-offset', '3px');
      await expect(company).toHaveCSS('outline-color', 'rgb(18, 101, 176)');
      const controlsContrast = await new AxeBuilder({ page })
        .include('[data-og7="edit-dossier-form"]')
        .include('[data-og7="moderation-actions"]')
        .withRules(['color-contrast'])
        .analyze();
      expect(controlsContrast.violations).toEqual([]);
      expect(
        controlsContrast.passes.some((rule) => rule.id === 'color-contrast')
      ).toBe(true);
      await page.keyboard.press('Escape');
      await expect(form).toHaveCount(0);
      await expect(opener).toBeFocused();
      await page.mouse.move(0, 0);
      await dossier
        .getByRole('heading', { name: 'Xbox fixture', exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`premium-dossier-${viewport.width}.png`),
        animations: 'disabled'
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(writes).toEqual([]);
      expect(state.commands).toEqual([]);
    });
  }
}

test.describe('Public prerendering', () => {
  test.use({ javaScriptEnabled: false });

  test('Premium Light leaves public SSR readable without JavaScript', async ({
    page
  }) => {
    // Administrative routes are client-rendered by the built-Web server;
    // exercise public prerendering through the normal isolated page fixture.
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 503, json: {} })
    );
    for (const [path, language] of [
      ['/fonds-des-batisseurs', 'fr-CA'],
      ['/en/fonds-des-batisseurs', 'en']
    ]) {
      expect((await page.goto(path))?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        'rgb(247, 245, 240)'
      );
      await expect(page.locator('body')).toHaveCSS('color', 'rgb(41, 51, 46)');
    }
  });
});
