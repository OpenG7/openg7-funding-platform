import type { AdminDashboardResponse } from '@openg7/funding-core';
import type { Page } from '@playwright/test';

import { cockpitFixtures } from './cockpit-fixtures.js';
import { controllerJourneysFixtures } from './controller-journeys.fixtures.js';

export const premiumAppearanceKey = 'openg7.pilotage.appearance.v1';

/** Complete synthetic admin surfaces; every attempted write is refused and recorded. */
export async function premiumFixtures(
  page: Page,
  language: string,
  dashboardResponse?: AdminDashboardResponse
) {
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
  }, premiumAppearanceKey);
  const cockpit = cockpitFixtures();
  const dashboard: AdminDashboardResponse = dashboardResponse ?? {
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
