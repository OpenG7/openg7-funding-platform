import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  PreflightRehearsalRun,
  PreflightRehearsalResponse,
  PreflightRehearsalStartRequest
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';

const routePath = '/admin/fundraiser/preflight';
const base = routePath + '?view=rehearsal';
const selectedRun = (value: string) =>
  base + '&rehearsalId=' + encodeURIComponent(value);
const api = '/api/admin/preflight/rehearsals';
const id = (value: number) =>
  '00000000-0000-4000-8000-' + String(value).padStart(12, '0');
const at = '2026-11-03T14:00:00.000Z';
const literalHtml = '<img src=x onerror="window.__recipeInjected=true">';

function run(runId: string, status = 'running'): PreflightRehearsalRun {
  const done = status === 'review_ready';
  const waiting = status === 'waiting_input';
  const uncertain = status === 'uncertain';
  return {
    id: runId,
    scenario: waiting ? 'missing_input' : 'standard',
    synthetic: true,
    title: 'Synthetic recipe ' + runId,
    createdAt: at,
    updatedAt: at,
    source: {
      application: 'funding-platform',
      subjectType: 'sponsorship-commitment',
      subjectId: id(99),
      version: 1,
      synthetic: true
    },
    missionId: id(100),
    missionStatus: uncertain ? null : status,
    delivery: uncertain ? 'uncertain' : 'acknowledged',
    submittedAt: uncertain ? null : at,
    lastCheckedAt: at,
    receivedAt: done ? at : null,
    steps: [
      { key: 'created', state: 'confirmed', at },
      {
        key: 'submitted',
        state: uncertain ? 'attention' : 'confirmed',
        at: uncertain ? null : at
      },
      {
        key: 'processing',
        state: uncertain
          ? 'pending'
          : done
            ? 'confirmed'
            : waiting
              ? 'attention'
              : 'active',
        at: uncertain ? null : at
      },
      {
        key: 'prepared',
        state: done ? 'confirmed' : 'pending',
        at: done ? at : null
      },
      {
        key: 'returned',
        state: done ? 'confirmed' : 'pending',
        at: done ? at : null
      },
      {
        key: 'review',
        state: done ? 'attention' : 'pending',
        at: done ? at : null
      }
    ],
    tasks: [
      {
        id: id(101),
        key: 'inspect',
        kind: 'completeness',
        status: waiting ? 'waiting_input' : 'completed',
        attempts: 1,
        startedAt: at,
        finishedAt: waiting ? null : at,
        errorCode: waiting ? 'missing_input' : null
      }
    ],
    proposals: done
      ? [
          {
            id: id(102),
            missionId: id(100),
            source: {
              application: 'funding-platform',
              subjectType: 'sponsorship-commitment',
              subjectId: id(99),
              version: 1
            },
            type: 'review',
            risk: 'normal',
            status: 'prepared',
            version: 1,
            createdAt: at,
            explanations: ['SYNTHETIC-PREPARATION'],
            limitations: ['SYNTHETIC-LIMITATION'],
            blockingConditions: ['Human review required.'],
            anomalies: [],
            checks: [{ resultId: id(103), kind: 'output-check', passed: true }],
            provenance: {
              provider: 'mock',
              model: 'synthetic-v1',
              simulated: true
            },
            authority: 'source_application',
            businessDecisionExecuted: false
          }
        ]
      : [],
    output: done
      ? {
          title: 'Returned synthetic preparation',
          summary: 'SYNTHETIC-RETURNED-SUMMARY',
          body: literalHtml,
          warnings: ['SYNTHETIC-LIMITATION'],
          provenance: {
            provider: 'mock',
            model: 'synthetic-v1',
            simulated: true
          }
        }
      : null,
    error: uncertain ? { code: 'preflight_timeout', retryable: true } : null,
    expectedSimulation: true,
    observedSimulated: done ? true : null,
    terminal: done || waiting,
    authority: 'source_application',
    businessDecisionExecuted: false
  };
}

async function fixtures(
  page: Page,
  language: 'fr-CA' | 'en' = 'fr-CA',
  ignoreAbort = false
) {
  await prepareAdminDesignReview(page);
  await page.addInitScript(
    ({ locale, ignore, endpoint }) => {
      localStorage.setItem('openg7.language', locale);
      if (ignore) {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const target = new URL(
            input instanceof Request ? input.url : String(input),
            location.href
          );
          return nativeFetch(
            input,
            target.pathname.startsWith(endpoint + '/')
              ? { ...init, signal: undefined }
              : init
          );
        };
      }
    },
    { locale: language, ignore: ignoreAbort, endpoint: api }
  );
  const state = {
    enabled: true,
    canLaunch: true,
    signedIn: true,
    current: null as PreflightRehearsalRun | null,
    posts: [] as PreflightRehearsalStartRequest[],
    resumes: [] as string[],
    reads: 0,
    completed: 0,
    getStatus: 200,
    postGate: null as Promise<void> | null,
    getGate: null as Promise<void> | null,
    authorizations: [] as (string | undefined)[],
    otherWrites: [] as string[],
    postStatus: 202,
    postRun: (request: PreflightRehearsalStartRequest) =>
      run(
        request.requestId,
        request.scenario === 'missing_input' ? 'waiting_input' : 'running'
      )
  };
  const response = (): PreflightRehearsalResponse => ({
    enabled: state.enabled,
    canLaunch: state.canLaunch,
    consoleUrl: 'https://preflight.example.test/',
    run: state.current,
    runs: state.current ? [state.current] : []
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (url.pathname === '/api/admin/auth/current')
      return route.fulfill(
        state.signedIn
          ? {
              json: {
                id: 'synthetic-recipe-operator',
                sessionId: 'synthetic-recipe-session',
                displayName: 'Synthetic operator',
                role: state.canLaunch ? 'operator' : 'reader',
                expiresAt: '2099-01-01T00:00:00Z'
              }
            }
          : { status: 401, json: {} }
      );
    if (url.pathname === api && method === 'GET')
      return route.fulfill({ json: response() });
    if (url.pathname === api && method === 'POST') {
      const body = request.postDataJSON() as PreflightRehearsalStartRequest;
      state.posts.push(body);
      state.authorizations.push(request.headers()['authorization']);
      await state.postGate;
      state.current = state.postRun(body);
      return route.fulfill({ status: state.postStatus, json: response() });
    }
    if (
      url.pathname.startsWith(api + '/') &&
      url.pathname.endsWith('/resume') &&
      method === 'POST'
    ) {
      state.resumes.push(url.pathname.split('/').at(-2)!);
      state.current = run(state.resumes.at(-1)!, 'review_ready');
      return route.fulfill({ json: response() });
    }
    if (url.pathname.startsWith(api + '/') && method === 'GET') {
      state.reads++;
      const status = state.getStatus;
      const snapshot = structuredClone(response());
      await state.getGate;
      try {
        return await route.fulfill({
          status,
          json:
            status === 200
              ? snapshot
              : {
                  code: 'PREFLIGHT_REHEARSAL_UNAVAILABLE',
                  error: 'Synthetic connection unavailable.'
                }
        });
      } catch (error) {
        if (!request.failure()) throw error;
      } finally {
        state.completed++;
      }
      return;
    }
    if (url.pathname === '/api/admin/preflight/inbox' && method === 'GET')
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
    if (method !== 'GET') state.otherWrites.push(method + ' ' + url.pathname);
    return route.fulfill({ status: 503, json: {} });
  });
  return state;
}

const panel = (page: Page) => page.locator('[data-og7="preflight-rehearsal"]');
const start = (page: Page) =>
  page.locator('[data-og7="preflight-rehearsal-start"]');
const refresh = (page: Page) =>
  page.locator('[data-og7="preflight-rehearsal-refresh"]');
const step = (page: Page, key: string) =>
  page.locator(`[data-og7="preflight-rehearsal-step"][data-og7-id="${key}"]`);

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`Preflight recipe follows actual server stages in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const state = await fixtures(page, language);
      await page.goto(base);
      await expect(start(page)).toBeEnabled();
      await start(page).focus();
      await page.keyboard.press('Enter');
      await expect(step(page, 'processing')).toHaveAttribute(
        'data-state',
        'active'
      );
      await expect(step(page, 'prepared')).toHaveAttribute(
        'data-state',
        'pending'
      );
      await expect(step(page, 'returned')).toHaveAttribute(
        'data-state',
        'pending'
      );
      await expect.poll(() => state.reads).toBeGreaterThan(0);
      await expect(step(page, 'returned')).toHaveAttribute(
        'data-state',
        'pending'
      );
      state.current = run(state.posts[0].requestId, 'review_ready');
      await expect(step(page, 'returned')).toHaveAttribute(
        'data-state',
        'confirmed'
      );
      await expect(step(page, 'review')).toHaveAttribute(
        'data-state',
        'attention'
      );
      await expect(panel(page)).toHaveAttribute('data-following', 'false');
      const output = page.locator('[data-og7="preflight-rehearsal-output"]');
      // The returned body must remain literal text, including any HTML-looking content.
      const details = output.locator('summary');
      if (await details.count()) await details.click();
      await expect(output).toContainText('SYNTHETIC-RETURNED-SUMMARY');
      await expect(output).toContainText(literalHtml);
      await expect(output.locator('img')).toHaveCount(0);
      await expect(panel(page)).toContainText(/simulat/i);
      expect(await page.evaluate(() => '__recipeInjected' in window)).toBe(
        false
      );
      expect(state.posts).toHaveLength(1);
      expect(state.authorizations).toEqual([undefined]);
      expect(state.otherWrites).toEqual([]);
      await expectAdminPageFits(page);
      const axe = await new AxeBuilder({ page })
        .include('[data-og7="preflight-rehearsal"]')
        .analyze();
      expect(axe.violations).toEqual([]);
    });
  }
}

test('Preflight recipe prevents duplicate commands and restores a run with GET only', async ({
  page
}) => {
  const state = await fixtures(page);
  let release!: () => void;
  state.postGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto(base);
  await start(page).click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expect(start(page)).toBeDisabled();
  expect(state.posts[0].requestId).toMatch(/^[\da-f-]{36}$/i);
  release();
  state.postGate = null;
  await expect(step(page, 'processing')).toHaveAttribute(
    'data-state',
    'active'
  );
  expect(new URL(page.url()).searchParams.get('rehearsalId')).toBe(
    state.posts[0].requestId
  );
  await page.reload();
  await expect(step(page, 'processing')).toHaveAttribute(
    'data-state',
    'active'
  );
  expect(state.posts).toHaveLength(1);
});

test('Preflight recipe shows an actual missing-input pause without a returned result', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base);
  await page
    .locator('[data-og7="preflight-rehearsal-scenario"]')
    .selectOption('missing_input');
  await start(page).click();
  await expect(step(page, 'processing')).toHaveAttribute(
    'data-state',
    'attention'
  );
  await expect(step(page, 'returned')).toHaveAttribute('data-state', 'pending');
  await expect(panel(page)).toHaveAttribute('data-following', 'false');
  await expect(
    page.locator('[data-og7="preflight-rehearsal-output"]')
  ).toHaveCount(0);
  expect(state.posts[0].scenario).toBe('missing_input');
  expect(state.resumes).toEqual([]);
});

test('Preflight recipe reconciles an uncertain send only after an explicit retry', async ({
  page
}) => {
  const state = await fixtures(page);
  state.postRun = (request) => run(request.requestId, 'uncertain');
  await page.goto(base);
  await start(page).click();
  await expect(step(page, 'submitted')).toHaveAttribute(
    'data-state',
    'attention'
  );
  await expect(panel(page)).toHaveAttribute('data-following', 'false');
  expect(state.resumes).toEqual([]);
  await page.locator('[data-og7="preflight-rehearsal-resume"]').click();
  await expect(step(page, 'returned')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  expect(state.posts).toHaveLength(1);
  expect(state.resumes).toEqual([state.posts[0].requestId]);
});

test('Preflight recipe respects disabled configuration and reader permissions', async ({
  page
}) => {
  const state = await fixtures(page);
  state.enabled = false;
  state.canLaunch = false;
  await page.goto(base);
  await expect(panel(page)).toHaveAttribute('data-state', 'disabled');
  await expect(start(page)).toHaveCount(0);
  state.enabled = true;
  await page.reload();
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await expect(start(page)).toBeDisabled();
  expect(state.posts).toEqual([]);
});

test('Preflight recipe retries a lost launch response with the same request identifier', async ({
  page
}) => {
  const state = await fixtures(page);
  state.postStatus = 503;
  await page.goto(base);
  await start(page).click();
  await expect(
    page.locator('[data-og7="preflight-rehearsal-error"]')
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
  state.postStatus = 202;
  await page.locator('[data-og7="preflight-rehearsal-resume"]').click();
  await expect(step(page, 'processing')).toHaveAttribute(
    'data-state',
    'active'
  );
  expect(state.posts).toHaveLength(2);
  expect(state.posts[1]).toEqual(state.posts[0]);
  expect(state.resumes).toEqual([]);
});

test('Preflight recipe removes returned content when access is refused', async ({
  page
}) => {
  const state = await fixtures(page);
  state.current = run(id(1), 'review_ready');
  await page.goto(selectedRun(id(1)));
  await expect(
    page.locator('[data-og7="preflight-rehearsal-output"]')
  ).toBeVisible();
  state.getStatus = 403;
  await refresh(page).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'forbidden');
  await expect(
    page.locator('[data-og7="preflight-rehearsal-output"]')
  ).toHaveCount(0);
});

test('Preflight recipe retains confirmed evidence during an observation failure', async ({
  page
}) => {
  const state = await fixtures(page);
  state.current = run(id(1), 'running');
  await page.goto(selectedRun(id(1)));
  await expect(step(page, 'submitted')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  state.getStatus = 503;
  await refresh(page).click();
  await expect(
    page.locator('[data-og7="preflight-rehearsal-error"]')
  ).toBeVisible();
  await expect(step(page, 'submitted')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  await expect(step(page, 'returned')).toHaveAttribute('data-state', 'pending');
  await expect(panel(page)).toHaveAttribute('data-following', 'false');
  expect(state.posts).toEqual([]);
});

test('Preflight recipe clears preparations when its Funding session expires', async ({
  page
}) => {
  const state = await fixtures(page);
  state.current = run(id(1), 'review_ready');
  await page.goto(selectedRun(id(1)));
  await expect(
    page.locator('[data-og7="preflight-rehearsal-output"]')
  ).toBeVisible();
  state.signedIn = false;
  state.getStatus = 401;
  await refresh(page).click();
  await expect(page).toHaveURL(/\/admin\/login\?/);
  await expect(panel(page)).toHaveCount(0);
});

test('Preflight recipe ignores a late 401 after leaving and reopening the page', async ({
  page
}) => {
  const state = await fixtures(page, 'fr-CA', true);
  state.current = run(id(1), 'review_ready');
  await page.goto(selectedRun(id(1)));
  await expect(step(page, 'returned')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  let release!: () => void;
  state.getGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.getStatus = 401;
  const readsBefore = state.reads;
  await refresh(page).click();
  await expect.poll(() => state.reads).toBeGreaterThan(readsBefore);
  await page
    .locator('openg7-admin-nav nav')
    .getByRole('link', { name: 'Cockpit', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  state.getGate = null;
  state.getStatus = 200;
  state.current = run(id(2), 'review_ready');
  await page
    .locator('openg7-admin-nav nav')
    .getByRole('link', { name: 'Preflight', exact: true })
    .click();
  await page
    .locator('[data-og7="preflight-workspace-tab"][data-og7-id="rehearsal"]')
    .click();
  await expect(panel(page)).toContainText(id(2));
  const completedBefore = state.completed;
  release();
  await expect.poll(() => state.completed).toBeGreaterThan(completedBefore);
  await expect(page).toHaveURL(new RegExp('/admin/fundraiser/preflight'));
  await expect(panel(page)).toContainText(id(2));
  expect(state.posts).toEqual([]);
});
