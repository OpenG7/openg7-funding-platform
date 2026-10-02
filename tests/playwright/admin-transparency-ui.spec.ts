import { AxeBuilder } from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { AdminTransparencyResponse } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const snapshot = (count: number, date: string): AdminTransparencyResponse => ({
  data_source: 'database',
  public_summary: {
    data_source: 'database',
    total_received: count * 100,
    total_fees: count,
    total_net: count * 99,
    total_refunded: 0,
    total_payouts: 0,
    current_available_estimate: count * 99,
    contributions_count: count,
    currency: 'CAD',
    monthly_summary: [],
    latest_public_allocations: [],
    public_builders: [],
    last_updated_at: date
  },
  expenses_summary: {
    total_count: 0,
    published_count: 0,
    draft_count: 0,
    private_count: 0,
    archived_count: 0,
    total_allocated: 0,
    published_allocated: 0,
    currency: 'CAD'
  },
  expenses: [],
  last_updated_at: date
});
const older = snapshot(10, '2026-09-23T12:00:00Z');
const newer = snapshot(20, '2026-09-24T12:00:00Z');

async function prepare(page: Page, language: string, width: number) {
  await page.setViewportSize({ width, height: 950 });
  await page.addInitScript((locale) => {
    localStorage.setItem('openg7.language', locale);
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.transparency-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, language);
  const requests: Route[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/config')) {
      return route.fulfill({ json: { mode: 'oidc' } });
    }
    if (path.endsWith('/auth/current')) {
      return route.fulfill({
        json: {
          id: 'transparency-reader-fixture',
          sessionId: 'transparency-session-fixture',
          displayName: 'Reader fixture',
          role: 'reader',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    }
    if (path.endsWith('/admin/transparency')) {
      requests.push(route);
      return;
    }
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/admin/fundraiser/transparency');
  await expect.poll(() => requests.length).toBe(1);
  const view = page.locator('[data-og7="admin-transparency"]');
  return {
    requests,
    view,
    refresh: view.getByRole('button', {
      name: language === 'en' ? 'Refresh' : 'Actualiser',
      exact: true
    }),
    current: view.locator('[data-og7="transparency-snapshot"]')
  };
}

async function complete(
  page: Page,
  route: Route,
  status: number,
  data = newer
) {
  const finished = page.waitForEvent(
    'requestfinished',
    (request) => request === route.request()
  );
  await route.fulfill({ status, json: status === 200 ? data : {} });
  await finished;
  // Wait for response handling and Angular rendering before checking a late reply.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1280]) {
    test(`transparency keeps the newest snapshot after late success and failure in ${language} at ${width}px`, async ({
      page
    }) => {
      const { requests, view, refresh, current } = await prepare(
        page,
        language,
        width
      );
      await complete(page, requests[0], 200, older);
      for (const lateStatus of [200, 500]) {
        const start = requests.length;
        await refresh.click();
        await expect.poll(() => requests.length).toBe(start + 1);
        const late = requests.at(-1)!;
        await refresh.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => requests.length).toBe(start + 2);
        await complete(page, requests.at(-1)!, 200);
        await expect(current.getByText('20', { exact: true })).toBeVisible();
        await expect(current).toContainText('24');
        await complete(page, late, lateStatus, older);
        await expect(current.getByText('20', { exact: true })).toBeVisible();
        await expect(current.getByText('10', { exact: true })).toHaveCount(0);
        await expect(view.getByRole('status')).toHaveCount(0);
        await expect(view.getByRole('alert')).toHaveCount(0);
        await expect(refresh).toBeFocused();
      }
    });

    test(`transparency stays loading after an older completion in ${language} at ${width}px`, async ({
      page
    }) => {
      const { requests, view, refresh, current } = await prepare(
        page,
        language,
        width
      );
      await refresh.click();
      await expect.poll(() => requests.length).toBe(2);
      await complete(page, requests[0], 200, older);
      await expect(view.getByRole('status')).toBeVisible();
      await expect(current).toHaveCount(0);
      await expect(view.getByRole('alert')).toHaveCount(0);
      await complete(page, requests[1], 500);
      await expect(view.getByRole('alert')).toBeVisible();
      await expect(view.getByRole('status')).toHaveCount(0);
      await expect(current).toHaveCount(0);
    });

    test(`transparency retains confirmed data on failure and recovers in ${language} at ${width}px`, async ({
      page
    }) => {
      const { requests, view, refresh, current } = await prepare(
        page,
        language,
        width
      );
      await complete(page, requests[0], 200);
      await refresh.click();
      await expect.poll(() => requests.length).toBe(2);
      await expect(view.getByRole('status')).toBeVisible();
      await expect(current.getByText('20', { exact: true })).toBeVisible();
      await complete(page, requests[1], 500);
      await expect(view.getByRole('alert')).toContainText(
        language === 'en'
          ? 'Could not load admin transparency.'
          : 'Impossible de charger la transparence admin'
      );
      await expect(current.getByText('20', { exact: true })).toBeVisible();
      await refresh.click();
      await expect.poll(() => requests.length).toBe(3);
      await complete(page, requests[2], 200);
      await expect(view.getByRole('alert')).toHaveCount(0);
      await expect(view.getByRole('status')).toHaveCount(0);
      await expect(current.getByText('20', { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      const accessibility = await new AxeBuilder({ page })
        .include('[data-og7="admin-transparency"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
    });
  }
}

test('leaving transparency ignores its pending response and preserves the current session', async ({
  page
}) => {
  const { requests, view } = await prepare(page, 'fr-CA', 1280);
  await page.locator('a[href="/admin/fundraiser/audit"]').first().click();
  await expect(page).toHaveURL(/\/admin\/fundraiser\/audit$/);
  await expect(view).toHaveCount(0);
  await page.evaluate(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.new-fixture'
    );
  });
  await complete(page, requests[0], 200);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBe('openg7-admin-session.new-fixture');
});
