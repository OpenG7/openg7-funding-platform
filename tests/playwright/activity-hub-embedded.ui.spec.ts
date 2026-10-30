import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { AdminDashboardResponse } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { controllerJourneysFixtures } from './support/controller-journeys.fixtures.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';

const hostPath = '/admin/fundraiser?search=synthetic-hub-filter#guide-context';
const guidance = (page: Page, name: string) =>
  page.locator(`[data-og7="admin-guidance-${name}"]`);
const hub = (page: Page) => page.locator('[data-og7="activity-hub-embedded"]');
const hook = (page: Page, name: string) =>
  hub(page).locator(`[data-og7="activity-hub-${name}"]`);
const card = (page: Page, id: string) =>
  hub(page).locator(`[data-og7="activity-hub-card"][data-og7-id="${id}"]`);

async function fixtures(
  page: Page,
  role: 'owner' | 'reader' = 'owner',
  locale = 'fr-CA'
) {
  const base = await controllerJourneysFixtures(page, role, locale, {
    hardware: 'native'
  });
  const state = {
    signedIn: true,
    accountId: 'synthetic-hub-account-a',
    sessionId: 'synthetic-hub-session-a',
    reads: [] as string[],
    writes: [] as string[],
    errors: [] as string[],
    base
  };
  page.on('pageerror', (error) => state.errors.push(error.message));
  const generatedAt = '2026-10-28T18:15:00Z';
  const dashboard: AdminDashboardResponse = {
    data_source: 'database',
    data_available: true,
    totals: {
      total_received: 0,
      total_refunded: 0,
      total_disputed: 0,
      current_available_estimate: 0,
      currency: 'CAD',
      contributions_count: 0,
      paid_contributions_count: 0
    },
    sponsorship_review: { total: 0, pending: 0, approved: 0, rejected: 0 },
    feed_publication: { planned: 0, drafted: 0, published: 0, active: 0 },
    stripe_events: { failed: 0, processing: 0, last_failed_at: null },
    recent_contributions: [],
    last_updated_at: generatedAt
  };
  const cockpit = cockpitFixtures();
  await page.route('**/api/admin/auth/current', (route) =>
    route.fulfill({
      status: state.signedIn ? 200 : 401,
      json: state.signedIn
        ? {
            id: state.accountId,
            sessionId: state.sessionId,
            displayName: 'Synthetic hub account',
            role,
            expiresAt: '2099-01-01T00:00:00Z'
          }
        : {}
    })
  );
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({
      status: state.signedIn ? 200 : 401,
      json: state.signedIn ? dashboard : {}
    })
  );
  await page.route('**/api/admin/cockpit/*', (route) => {
    const block = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({
      status: state.signedIn ? 200 : 401,
      json:
        state.signedIn && block && Object.hasOwn(cockpit, block)
          ? cockpit[block as keyof typeof cockpit]
          : {}
    });
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      state.writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({
        status: 405,
        json: { error: 'Read-only fixture' }
      });
    }
    state.reads.push(url.pathname + url.search);
    return route.fallback();
  });
  return state;
}

async function openHost(
  page: Page,
  state: Awaited<ReturnType<typeof fixtures>>
) {
  await page.goto(hostPath);
  await expect(guidance(page, 'toggle')).toBeVisible();
  await expect
    .poll(() =>
      ['metrics', 'activity', 'systems'].every((block) =>
        state.reads.includes(`/api/admin/cockpit/${block}`)
      )
    )
    .toBe(true);
}

async function openDiscovery(page: Page) {
  if (!(await guidance(page, 'panel').isVisible()))
    await guidance(page, 'toggle').click();
  if (!(await hub(page).isVisible()))
    await guidance(page, 'discovery-mode').click();
  await expect(hub(page)).toBeVisible();
}

async function section(page: Page, id: string) {
  await hub(page)
    .locator(`[data-og7="activity-hub-section"][data-og7-id="${id}"]`)
    .click();
}

function expectReadOnly(state: Awaited<ReturnType<typeof fixtures>>) {
  expect(state.writes).toEqual([]);
  expect(state.base.commands).toEqual([]);
  expect(state.errors).toEqual([]);
}

const conciseViolations = (
  violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']
) =>
  violations.map(({ id, nodes }) => ({
    id,
    nodeCount: nodes.length,
    nodes: nodes.slice(0, 3).map(({ target, failureSummary }) => ({
      target,
      failureSummary
    }))
  }));

for (const [role, locale] of [
  ['owner', 'fr-CA'],
  ['reader', 'en']
] as const) {
  test(`loads discovery lazily inside its existing administrative frame for ${role} in ${locale}`, async ({
    page
  }) => {
    const state = await fixtures(page, role, locale);
    const hubChunks: string[] = [];
    await page.route('**/*.js', async (route) => {
      const response = await route.fetch();
      if ((await response.text()).includes('openg7-activity-hub-embedded'))
        hubChunks.push(new URL(route.request().url()).pathname);
      return route.fulfill({ response });
    });
    await openHost(page, state);
    const sourceUrl = page.url();
    await expect(hub(page)).toHaveCount(0);
    expect(hubChunks).toEqual([]);
    const hostMain = await page.locator('#admin-main').elementHandle();
    expect(hostMain).not.toBeNull();
    const before = [...state.reads];
    await guidance(page, 'toggle').focus();
    await page.keyboard.press('Enter');
    await expect(hub(page)).toBeVisible();
    await expect.poll(() => hubChunks.length).toBe(1);
    await expect(hub(page).getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(hub(page).getByRole('main')).toHaveCount(0);
    await expect(hub(page).getByRole('banner')).toHaveCount(0);
    await expect(hub(page).locator('iframe')).toHaveCount(0);
    await expect(page.locator('#admin-main')).toHaveCount(1);
    await expect(hub(page).locator('#activity-hub-content')).toHaveCount(1);
    await expect(guidance(page, 'modes').getByRole('button')).toHaveCount(2);
    await expect(hub(page).locator('#activity-hub-title')).toHaveText(
      locale === 'en' ? 'Discover' : 'Découvrir'
    );
    await section(page, 'journal');
    await expect(hook(page, 'activity-row')).toHaveCount(10);
    await section(page, 'briefing');
    await expect(hook(page, 'briefing')).toBeVisible();
    await guidance(page, 'toggle').click();
    await expect(hub(page)).toBeHidden();
    await guidance(page, 'toggle').click();
    await expect(hook(page, 'briefing')).toBeVisible();
    expect(hubChunks).toHaveLength(1);
    await expect(page).toHaveURL(sourceUrl);
    expect(await hostMain!.evaluate((element) => element.isConnected)).toBe(
      true
    );
    expect(state.reads).toEqual(before);
    expectReadOnly(state);
  });
}

test('retains readings, saved items and journal filters through service delivery and collapse', async ({
  page
}) => {
  const state = await fixtures(page);
  await openHost(page, state);
  await openDiscovery(page);
  const sourceUrl = page.url();
  const instance = await hub(page).elementHandle();
  await section(page, 'resources');
  const guide = card(page, 'guide-context');
  await guide.locator('[data-og7="activity-hub-save"]').click();
  await guide.locator('[data-og7="activity-hub-open"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await section(page, 'journal');
  await hook(page, 'activity-period').selectOption('all');
  await hook(page, 'activity-kind').selectOption('media');
  await hook(page, 'activity-origin').selectOption('human');
  await expect(hook(page, 'activity-row')).toHaveCount(2);
  await guidance(page, 'service-delivery-mode').click();
  await expect(
    page.locator('[data-og7="service-delivery-embedded"]')
  ).toBeVisible();
  await expect(hub(page)).toBeHidden();
  expect(await instance!.evaluate((element) => element.isConnected)).toBe(true);
  await guidance(page, 'discovery-mode').click();
  await expect(hook(page, 'activity-period')).toHaveValue('all');
  await expect(hook(page, 'activity-kind')).toHaveValue('media');
  await expect(hook(page, 'activity-origin')).toHaveValue('human');
  await expect(hook(page, 'activity-row')).toHaveCount(2);
  await guidance(page, 'toggle').click();
  await expect(hub(page)).toBeHidden();
  await guidance(page, 'toggle').click();
  await expect(hook(page, 'activity-row')).toHaveCount(2);
  await section(page, 'saved');
  await expect(card(page, 'guide-context')).toBeVisible();
  await section(page, 'briefing');
  await expect(hook(page, 'briefing-counts').locator('dd')).toHaveText([
    '1',
    '14',
    '13'
  ]);
  await expect(hook(page, 'briefing-saved-empty')).toBeVisible();
  await expect(page).toHaveURL(sourceUrl);
  expect(await instance!.evaluate((element) => element.isConnected)).toBe(true);
  expectReadOnly(state);
});

test('opens a synthetic activity dossier in the host service workspace without changing its URL', async ({
  page
}) => {
  const state = await fixtures(page);
  await openHost(page, state);
  await openDiscovery(page);
  const sourceUrl = page.url();
  await section(page, 'journal');
  await hub(page)
    .locator(
      '[data-og7="activity-hub-activity-row"][data-og7-id="activity-ready-boreal-28"]'
    )
    .locator('[data-og7="activity-hub-activity-open"]')
    .click();
  const link = page.locator('[data-og7="activity-hub-activity-dossier"]');
  await expect(link).toHaveAttribute(
    'href',
    '/demo/prestations/dossier/atelier-boreal'
  );
  await link.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.locator('[data-og7="service-delivery-embedded"]')
  ).toBeVisible();
  await expect(guidance(page, 'service-delivery-mode')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('[data-og7="service-demo"]')).toContainText(
    'Atelier Boréal'
  );
  await expect(page).toHaveURL(sourceUrl);
  await page.locator('[data-og7="service-demo-exit"]').click();
  await expect(hub(page)).toBeVisible();
  await expect(hook(page, 'activity-list')).toBeVisible();
  await expect(page).toHaveURL(sourceUrl);
  expectReadOnly(state);
});

test('keeps keyboard focus and accessibility within the existing guide frame', async ({
  page
}, info) => {
  const state = await fixtures(page);
  await openHost(page, state);
  await openDiscovery(page);
  await section(page, 'resources');
  const opener = card(page, 'guide-context').locator(
    '[data-og7="activity-hub-open"]'
  );
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Fermer', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await section(page, 'overview');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    )
    .toBe(true);
  const audit = await new AxeBuilder({ page })
    .include('[data-og7="admin-guidance"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(conciseViolations(audit.violations)).toEqual([]);
  await page.screenshot({
    path: info.outputPath('activity-hub-in-admin.png'),
    animations: 'disabled'
  });
  expectReadOnly(state);
});

test('destroys the local instance on revocation and starts another account with fresh reading state', async ({
  page
}) => {
  const state = await fixtures(page);
  await openHost(page, state);
  await openDiscovery(page);
  const previous = await hub(page).elementHandle();
  await section(page, 'resources');
  await card(page, 'guide-context')
    .locator('[data-og7="activity-hub-save"]')
    .click();
  state.signedIn = false;
  await page.locator('[data-og7="dashboard-refresh"]').click();
  await expect(page).toHaveURL(/\/admin\/login\?/);
  await expect(hub(page)).toHaveCount(0);
  expect(await previous!.evaluate((element) => element.isConnected)).toBe(
    false
  );
  state.signedIn = true;
  state.accountId = 'synthetic-hub-account-b';
  state.sessionId = 'synthetic-hub-session-b';
  await openHost(page, state);
  await openDiscovery(page);
  await section(page, 'saved');
  await expect(hook(page, 'card')).toHaveCount(0);
  await section(page, 'briefing');
  await expect(hook(page, 'briefing-counts').locator('dd')).toHaveText([
    '0',
    '14',
    '14'
  ]);
  expectReadOnly(state);
});

test('can retry a failed lazy discovery import without navigating or writing business data', async ({
  page
}) => {
  const state = await fixtures(page);
  let blocked = true;
  const failed: string[] = [];
  await page.route('**/*.js', async (route) => {
    const response = await route.fetch();
    if (
      blocked &&
      (await response.text()).includes('openg7-activity-hub-embedded')
    ) {
      failed.push(new URL(route.request().url()).pathname);
      return route.abort();
    }
    return route.fulfill({ response });
  });
  await openHost(page, state);
  const sourceUrl = page.url();
  await guidance(page, 'toggle').click();
  await expect(guidance(page, 'content').getByRole('alert')).toBeVisible();
  await expect(hub(page)).toHaveCount(0);
  expect(new Set(failed).size).toBe(1);
  blocked = false;
  await guidance(page, 'activity-hub-retry').click();
  await expect(hub(page)).toBeVisible();
  await expect(guidance(page, 'content').getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(sourceUrl);
  expectReadOnly(state);
});
