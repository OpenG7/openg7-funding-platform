import type { Page } from '@playwright/test';
import type {
  AdminAttentionItem,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const dossierId = '10000000-0000-4000-8000-000000000891';
const taskId = `sponsorship_media_review:${dossierId}`;
const path = '/admin/fundraiser/attention';
type Phase = 'waiting' | 'review' | 'resolved';

async function queueFixture(page: Page) {
  const state = { phase: 'waiting' as Phase };
  const reads: URL[] = [];
  const writes: string[] = [];
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
    localStorage.setItem('openg7.language', 'fr-CA');
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      writes.push(request.method() + ' ' + url.pathname);
    if (url.pathname !== '/api/admin/attention')
      return route.fulfill({
        status: 503,
        json: { error: 'Synthetic fixture unavailable' }
      });
    reads.push(url);
    const review = state.phase === 'review';
    const present = state.phase !== 'resolved';
    const item: AdminAttentionItem = {
      id: taskId,
      type: 'sponsorship_media_review',
      severity: review ? 'today' : 'informational',
      title: 'Synthetic media task',
      explanation: 'Synthetic current facts',
      contributionId: dossierId,
      sponsorshipId: dossierId,
      detectedAt: '2026-11-18T11:00:00Z',
      adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=media`,
      facts: {
        phase: state.phase,
        reference: 'DEMO-MEDIA-891',
        reviewCount: review ? 1 : 0,
        authorizationRequiredCount: review ? 0 : 1,
        missingAltCount: review ? 1 : 0,
        changedAt: '2026-11-18T11:00:00Z',
        daysWaiting: 0,
        tab: 'media'
      },
      suggestedActions: []
    };
    const response: AdminWorkQueueResponse = {
      available: true,
      coverage: 'complete',
      missingSources: [],
      generatedAt: new Date().toISOString(),
      timezone: 'America/Toronto',
      total: present ? 1 : 0,
      filteredTotal: present ? 1 : 0,
      todayTotal: review ? 1 : 0,
      pendingDossierCount: review ? 1 : 0,
      counts: {
        urgent: 0,
        today: review ? 1 : 0,
        this_week: 0,
        informational: present && !review ? 1 : 0
      },
      typeCounts: {
        sponsorship_media_review: present ? 1 : 0
      } as AdminWorkQueueResponse['typeCounts'],
      actionCounts: { sponsorship_media_review: review ? 1 : 0 },
      page: 1,
      pageSize: Number(url.searchParams.get('pageSize') || 25),
      items: present ? [item] : []
    };
    return route.fulfill({ json: response });
  });
  return { state, reads, writes };
}

const task = (page: Page) =>
  page.locator(`[data-og7="attention-items"] [data-og7-id="${taskId}"]`);
const badge = (page: Page, name = 'attention') =>
  page.locator(`[data-og7="nav-count"][data-og7-id="${name}"]`);

test('a consent received elsewhere refreshes the open queue and both badges without disrupting focus', async ({
  page
}) => {
  const fixture = await queueFixture(page);
  await page.clock.install({ time: new Date('2026-11-18T12:00:00Z') });
  await page.goto(path);
  await expect(task(page)).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
  const filter = page.locator('[data-og7="attention-type"]');
  await filter.selectOption('sponsorship_media_review');
  await expect(page).toHaveURL(/type=sponsorship_media_review/);
  await expect(page.locator('[data-og7="attention-panel"]')).toHaveAttribute(
    'aria-busy',
    'false'
  );
  await filter.focus();
  const originalFilter = await filter.elementHandle();
  const before = fixture.reads.length;
  fixture.state.phase = 'review';
  await page.clock.fastForward(31_000);
  await expect(
    page.locator('[data-og7="attention-media-review-count"]')
  ).toBeVisible();
  await expect(
    page.locator('[data-og7="attention-media-missing-alt"]')
  ).toBeVisible();
  await expect(badge(page)).toHaveText('1');
  await expect(badge(page, 'sponsors')).toHaveText('1');
  await expect(filter).toBeFocused();
  expect(await originalFilter!.evaluate((element) => element.isConnected)).toBe(
    true
  );
  expect(fixture.reads.length).toBe(before + 1);
  expect(fixture.reads.at(-1)!.searchParams.get('type')).toBe(
    'sponsorship_media_review'
  );
  expect(fixture.reads.at(-1)!.searchParams.get('pageSize')).toBe('25');
  fixture.state.phase = 'resolved';
  await page.clock.fastForward(31_000);
  await expect(task(page)).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
  await expect(badge(page, 'sponsors')).toHaveCount(0);
  await expect(filter).toBeFocused();
  expect(fixture.writes).toEqual([]);
});

test('returning to the foreground refreshes a media task once and stops polling after leaving administration', async ({
  page
}) => {
  const fixture = await queueFixture(page);
  await page.clock.install({ time: new Date('2026-11-18T12:00:00Z') });
  await page.goto(path);
  await expect(task(page)).toBeVisible();
  const before = fixture.reads.length;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  fixture.state.phase = 'review';
  await page.clock.fastForward(91_000);
  expect(fixture.reads.length).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(badge(page)).toHaveText('1');
  await expect(
    page.locator('[data-og7="attention-media-review-count"]')
  ).toBeVisible();
  expect(fixture.reads.length).toBe(before + 1);
  await page.locator('openg7-admin-nav footer a').last().click();
  await expect(page.locator('openg7-admin-nav')).toHaveCount(0);
  const afterLeaving = fixture.reads.length;
  await page.clock.fastForward(65_000);
  expect(fixture.reads.length).toBe(afterLeaving);
  expect(fixture.writes).toEqual([]);
});

test('navigation counters detect a new media review while another administration page is open', async ({
  page
}) => {
  const fixture = await queueFixture(page);
  await page.clock.install({ time: new Date('2026-11-18T12:00:00Z') });
  await page.goto('/admin/fundraiser/audit');
  await expect(page.locator('openg7-admin-nav')).toBeVisible();
  await expect.poll(() => fixture.reads.length).toBeGreaterThan(0);
  await expect(badge(page)).toHaveCount(0);
  const before = fixture.reads.length;
  fixture.state.phase = 'review';
  await page.clock.fastForward(31_000);
  await expect(badge(page)).toHaveText('1');
  await expect(badge(page, 'sponsors')).toHaveText('1');
  expect(fixture.reads.length).toBe(before + 1);
  expect(fixture.reads.at(-1)!.searchParams.get('pageSize')).toBe('1');
  await page
    .locator('openg7-admin-nav nav a[href="/admin/fundraiser/attention"]')
    .click();
  await expect(task(page)).toBeVisible();
  await expect(
    page.locator('[data-og7="attention-media-missing-alt"]')
  ).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test('an expired session during automatic refresh clears the private queue and stops its reads', async ({
  page
}) => {
  const fixture = await queueFixture(page);
  await page.clock.install({ time: new Date('2026-11-18T12:00:00Z') });
  await page.goto(path + '?type=sponsorship_media_review');
  await expect(task(page)).toBeVisible();
  let expiredReads = 0;
  await page.route('**/api/admin/attention?**', (route) => {
    expiredReads++;
    return route.fulfill({ status: 401, json: {} });
  });
  await page.clock.fastForward(31_000);
  await expect(page).toHaveURL(/admin\/login\?returnUrl=/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(
    path + '?type=sponsorship_media_review'
  );
  await expect(task(page)).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
  await page.clock.fastForward(65_000);
  expect(expiredReads).toBe(1);
  expect(fixture.writes).toEqual([]);
});

test('a navigation-only refresh refusal returns to login once and stops all background queue reads', async ({
  page
}) => {
  const fixture = await queueFixture(page);
  fixture.state.phase = 'review';
  await page.clock.install({ time: new Date('2026-11-18T12:00:00Z') });
  const returnUrl = '/admin/fundraiser/audit?kind=synthetic';
  await page.goto(returnUrl);
  await expect(page.locator('openg7-admin-nav')).toBeVisible();
  await expect(page.locator('[data-og7="attention-panel"]')).toHaveCount(0);
  await expect(badge(page)).toHaveText('1');
  await expect(badge(page, 'sponsors')).toHaveText('1');
  let expiredReads = 0;
  await page.route('**/api/admin/attention?**', (route) => {
    expiredReads++;
    return route.fulfill({ status: 401, json: {} });
  });

  await page.clock.fastForward(31_000);
  await expect(page).toHaveURL(/admin\/login\?returnUrl=/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(returnUrl);
  expect(new URL(page.url()).searchParams.get('sessionExpired')).toBe('1');
  await expect(page.locator('openg7-admin-nav')).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      token: sessionStorage.getItem('openg7-admin-session-token'),
      expiry: sessionStorage.getItem('openg7-admin-session-expires-at')
    }))
  ).toEqual({ token: null, expiry: null });
  await page.clock.fastForward(65_000);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  expect(expiredReads).toBe(1);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(returnUrl);
  expect(fixture.writes).toEqual([]);
});
