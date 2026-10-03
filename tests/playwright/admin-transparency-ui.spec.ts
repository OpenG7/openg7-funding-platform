import { AxeBuilder } from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type {
  AdminExpenseRecord,
  AdminTransparencyResponse
} from '@openg7/funding-core';

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

function withAllocations(
  data: AdminTransparencyResponse
): AdminTransparencyResponse {
  const count = data.public_summary.contributions_count;
  const allocation = (
    status: AdminExpenseRecord['status'],
    amount: number
  ): AdminExpenseRecord => ({
    id: `${status}-allocation-${count}`,
    project_name: `${status} allocation ${count}`,
    public_description: `Public description for ${status} ${count}`,
    expected_outcome: 'Synthetic outcome',
    progress_status: 'planned',
    proof_url: null,
    proof_source: null,
    proof_published_at: null,
    amount_allocated: amount,
    currency: 'CAD',
    status,
    published_at: status === 'published' ? data.last_updated_at : null,
    created_at: data.last_updated_at,
    updated_at: data.last_updated_at
  });
  return {
    ...data,
    public_summary: {
      ...data.public_summary,
      total_refunded: 7.5,
      total_payouts: 12.75,
      current_available_estimate: data.public_summary.total_net - 7.5
    },
    expenses_summary: {
      ...data.expenses_summary,
      total_count: 5,
      published_count: 2,
      draft_count: 1,
      private_count: 1,
      archived_count: 1,
      total_allocated: 300.25,
      published_allocated: 175.25
    },
    expenses: [
      allocation('published', 125.25),
      allocation('active', 50),
      allocation('draft', 40),
      allocation('private', 60),
      allocation('archived', 25)
    ]
  };
}

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
      await complete(page, requests[0], 200, withAllocations(older));
      for (const lateStatus of [200, 500]) {
        const start = requests.length;
        await refresh.click();
        await expect.poll(() => requests.length).toBe(start + 1);
        const late = requests.at(-1)!;
        await refresh.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => requests.length).toBe(start + 2);
        await complete(page, requests.at(-1)!, 200, withAllocations(newer));
        await expect(current.getByText('20', { exact: true })).toBeVisible();
        await expect(current).toContainText('24');
        await complete(page, late, lateStatus, withAllocations(older));
        await expect(current.getByText('20', { exact: true })).toBeVisible();
        await expect(current.getByText('10', { exact: true })).toHaveCount(0);
        await expect(
          view.getByRole('cell', {
            name: 'published allocation 20',
            exact: true
          })
        ).toBeVisible();
        await expect(
          view.getByRole('cell', {
            name: 'published allocation 10',
            exact: true
          })
        ).toHaveCount(0);
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
      const confirmed = withAllocations(newer);
      const money = (amount: number) =>
        new Intl.NumberFormat(language, {
          style: 'currency',
          currency: 'CAD'
        }).format(amount);
      const summary = view.locator('[data-og7="transparency-summary"]');
      const statuses = view.locator('[data-og7="transparency-statuses"]');
      const allocations = view.locator('[data-og7="transparency-allocations"]');
      await complete(page, requests[0], 200, confirmed);
      await expect(summary.locator('strong')).toHaveText([
        money(2000),
        money(1980),
        money(1972.5),
        money(175.25)
      ]);
      await expect(statuses.locator('strong')).toHaveText(['5', '2', '1', '1']);
      await expect(current.locator('dd')).toHaveText([
        '20',
        money(20),
        money(7.5),
        money(12.75)
      ]);
      await expect(allocations.getByRole('row')).toHaveCount(3);
      for (const status of ['draft', 'private', 'archived']) {
        await expect(
          allocations.getByRole('cell', {
            name: `${status} allocation 20`,
            exact: true
          })
        ).toHaveCount(0);
      }
      await expect(
        allocations.getByRole('row').nth(1).getByRole('cell').nth(2)
      ).toHaveText(money(125.25));
      await expect(
        allocations.getByRole('row').nth(2).getByRole('cell').nth(2)
      ).toHaveText(money(50));
      await expect(
        allocations.getByRole('row').nth(2).getByRole('cell').nth(3)
      ).toHaveText(language === 'en' ? 'Not available' : 'Non disponible');
      await refresh.click();
      await expect.poll(() => requests.length).toBe(2);
      await expect(view.getByRole('status')).toBeVisible();
      await expect(current.getByText('20', { exact: true })).toBeVisible();
      await expect(summary.locator('strong').last()).toHaveText(money(175.25));
      await expect(allocations.getByRole('row')).toHaveCount(3);
      await complete(page, requests[1], 500);
      await expect(view.getByRole('alert')).toContainText(
        language === 'en'
          ? 'Could not load admin transparency.'
          : 'Impossible de charger la transparence admin'
      );
      await expect(current.getByText('20', { exact: true })).toBeVisible();
      await expect(summary.locator('strong').last()).toHaveText(money(175.25));
      await expect(allocations.getByRole('row')).toHaveCount(3);
      await refresh.click();
      await expect.poll(() => requests.length).toBe(3);
      await complete(page, requests[2], 200, confirmed);
      await expect(view.getByRole('alert')).toHaveCount(0);
      await expect(view.getByRole('status')).toHaveCount(0);
      await expect(current.getByText('20', { exact: true })).toBeVisible();
      const allocationScroll = allocations.getByRole('region', {
        name:
          language === 'en'
            ? 'Public expenses'
            : 'Depenses visibles publiquement',
        exact: true
      });
      await refresh.focus();
      await page.keyboard.press('Tab');
      await expect(allocationScroll).toBeFocused();
      await expect(allocationScroll).toHaveCSS('outline-style', 'solid');
      await expect(allocationScroll).toHaveCSS('outline-width', '3px');
      if (width === 390) {
        expect(
          await allocationScroll.evaluate(
            (element) => element.scrollWidth > element.clientWidth
          )
        ).toBe(true);
        await page.keyboard.press('ArrowRight');
        await expect
          .poll(() =>
            allocationScroll.evaluate((element) => element.scrollLeft)
          )
          .toBeGreaterThan(20);
        await page.keyboard.press('ArrowLeft');
        await expect
          .poll(() =>
            allocationScroll.evaluate((element) => element.scrollLeft)
          )
          .toBe(0);
        await expect(allocationScroll).toBeFocused();
      }
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

    test(`transparency distinguishes confirmed zeroes from initial failure in ${language} at ${width}px`, async ({
      page
    }) => {
      const { requests, view, refresh, current } = await prepare(
        page,
        language,
        width
      );
      const summary = view.locator('[data-og7="transparency-summary"]');
      const allocations = view.locator('[data-og7="transparency-allocations"]');
      await complete(page, requests[0], 500);
      await expect(view.getByRole('alert')).toBeVisible();
      await expect(summary).toHaveCount(0);
      await expect(current).toHaveCount(0);
      await expect(allocations).toHaveCount(0);
      await refresh.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => requests.length).toBe(2);
      await complete(
        page,
        requests[1],
        200,
        snapshot(0, newer.last_updated_at)
      );
      const zero = new Intl.NumberFormat(language, {
        style: 'currency',
        currency: 'CAD'
      }).format(0);
      await expect(summary.locator('strong')).toHaveText([
        zero,
        zero,
        zero,
        zero
      ]);
      await expect(current.locator('dd').first()).toHaveText('0');
      await expect(allocations.getByRole('table')).toHaveCount(0);
      await expect(allocations.getByRole('heading', { level: 3 })).toHaveText(
        language === 'en' ? 'No public expenses' : 'Aucune depense publique'
      );
      await expect(view.getByRole('alert')).toHaveCount(0);
      await expect(refresh).toBeFocused();
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
