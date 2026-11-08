import type { Page } from '@playwright/test';
import type {
  PreflightRehearsalResponse,
  PreflightRehearsalRun
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { prepareAdminDesignReview } from './support/admin-design-review.js';

const base = '/admin/fundraiser/preflight';
const api = '/api/admin/preflight/rehearsals';
const runId = '00000000-0000-4000-8000-000000000001';
const missionId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000003';
const at = '2026-11-04T14:00:00.000Z';

function ongoingRun(): PreflightRehearsalRun {
  return {
    id: runId,
    scenario: 'standard',
    synthetic: true,
    title: 'Synthetic workspace recipe',
    createdAt: at,
    updatedAt: at,
    source: {
      application: 'funding-platform',
      subjectType: 'sponsorship-commitment',
      subjectId: sourceId,
      version: 1,
      synthetic: true
    },
    missionId,
    missionStatus: 'running',
    delivery: 'acknowledged',
    submittedAt: at,
    lastCheckedAt: at,
    receivedAt: null,
    steps: [
      { key: 'created', state: 'confirmed', at },
      { key: 'submitted', state: 'confirmed', at },
      { key: 'processing', state: 'active', at },
      { key: 'prepared', state: 'pending', at: null },
      { key: 'returned', state: 'pending', at: null },
      { key: 'review', state: 'pending', at: null }
    ],
    tasks: [],
    proposals: [],
    output: null,
    error: null,
    expectedSimulation: true,
    observedSimulated: null,
    terminal: false,
    authority: 'source_application',
    businessDecisionExecuted: false
  };
}

async function fixtures(page: Page) {
  await prepareAdminDesignReview(page);
  await page.addInitScript(() =>
    localStorage.setItem('openg7.language', 'fr-CA')
  );
  const current = ongoingRun();
  const state = {
    configurationReads: 0,
    observationReads: 0,
    writes: [] as string[]
  };
  const response = (): PreflightRehearsalResponse => ({
    enabled: true,
    canLaunch: true,
    consoleUrl: 'https://preflight.example.test/',
    run: current,
    runs: [current]
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      state.writes.push(request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 405, json: {} });
    }
    if (url.pathname === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (url.pathname === '/api/admin/auth/current')
      return route.fulfill({
        json: {
          id: 'synthetic-workspace-operator',
          sessionId: 'synthetic-workspace-session',
          displayName: 'Synthetic operator',
          role: 'operator',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (url.pathname === api) {
      state.configurationReads++;
      return route.fulfill({ json: response() });
    }
    if (url.pathname === api + '/' + runId) {
      state.observationReads++;
      return route.fulfill({ json: response() });
    }
    if (url.pathname === '/api/admin/preflight/inbox')
      return route.fulfill({
        json: {
          state: 'ready',
          consoleUrl: 'https://preflight.example.test/',
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          authority: 'source_application',
          businessDecisionExecuted: false
        }
      });
    // The desk is intentionally unavailable in these isolated navigation fixtures.
    // No inferred business counts or delivery facts are supplied by the test.
    return route.fulfill({
      status: 503,
      json: { error: 'Synthetic desk unavailable.' }
    });
  });
  return state;
}

const tab = (page: Page, key: string) =>
  page.locator(`[data-og7="preflight-workspace-tab"][data-og7-id="${key}"]`);
const panel = (page: Page, key: string) =>
  page.locator(`[data-og7="preflight-workspace-panel"][data-og7-id="${key}"]`);
const recipe = (page: Page) => page.locator('[data-og7="preflight-rehearsal"]');

test('Preflight workspace restores its selected view and provides keyboard tab navigation', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base);
  await expect(tab(page, 'desk')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, 'desk')).toBeVisible();
  await tab(page, 'desk').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'rehearsal')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'rehearsal')).toBeFocused();
  await expect(recipe(page)).toHaveAttribute('data-mode', 'rehearsal');
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'proposals')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, 'proposals')).toBeVisible();
  await expect(recipe(page)).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(tab(page, 'evidence')).toHaveAttribute('aria-selected', 'true');
  await expect(recipe(page)).toHaveAttribute('data-mode', 'evidence');
  expect(new URL(page.url()).searchParams.get('view')).toBe('evidence');
  await page.reload();
  await expect(tab(page, 'evidence')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, 'evidence')).toBeVisible();
  await tab(page, 'evidence').focus();
  await page.keyboard.press('Home');
  await expect(tab(page, 'desk')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'evidence')).toHaveAttribute('aria-selected', 'true');
  expect(state.writes).toEqual([]);
});

test('Preflight evidence preserves one observer across the two recipe views and stops outside them', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.clock.install();
  await page.goto(base + '?view=rehearsal&rehearsalId=' + runId);
  await expect(recipe(page)).toHaveAttribute('data-following', 'true');
  await expect.poll(() => state.observationReads).toBe(1);
  await tab(page, 'evidence').click();
  await expect(recipe(page)).toHaveAttribute('data-mode', 'evidence');
  await expect(recipe(page)).toHaveCount(1);
  expect(state.observationReads).toBe(1);
  await page.clock.runFor(2100);
  await expect.poll(() => state.observationReads).toBe(2);
  await page.clock.runFor(2100);
  await expect.poll(() => state.observationReads).toBe(3);
  await tab(page, 'desk').click();
  await expect(recipe(page)).toHaveCount(0);
  await page.clock.runFor(10000);
  expect(state.observationReads).toBe(3);
  await tab(page, 'evidence').click();
  await expect(recipe(page)).toHaveAttribute('data-following', 'true');
  await expect.poll(() => state.observationReads).toBe(4);
  expect(new URL(page.url()).searchParams.get('rehearsalId')).toBe(runId);
  expect(state.writes).toEqual([]);
});

test('Preflight evidence is read-only even for an operator and survives reload with GET only', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base + '?view=evidence&rehearsalId=' + runId);
  await expect(recipe(page)).toHaveAttribute('data-mode', 'evidence');
  await expect(
    page.locator('[data-og7="preflight-rehearsal-step"]')
  ).toHaveCount(6);
  await expect(
    page.locator('[data-og7="preflight-rehearsal-scenario"]')
  ).toHaveCount(0);
  await expect(
    page.locator('[data-og7="preflight-rehearsal-start"]')
  ).toHaveCount(0);
  await expect(
    page.locator('[data-og7="preflight-rehearsal-resume"]')
  ).toHaveCount(0);
  await expect(
    page.locator('[data-og7="preflight-rehearsal-run"]')
  ).toBeVisible();
  await page.reload();
  await expect(recipe(page)).toHaveAttribute('data-mode', 'evidence');
  await expect.poll(() => state.observationReads).toBe(2);
  expect(state.writes).toEqual([]);
});
