import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  PreflightInboxProposal,
  PreflightInboxResponse,
  PreflightInboxUnavailable
} from '@openg7/funding-core';

import { expect, sampledFrames, test } from './support/test.js';
import {
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';

const routePath = '/admin/fundraiser/preflight';
const base = routePath + '?view=proposals';
const endpoint = '/api/admin/preflight/inbox';
const consoleUrl = 'https://preflight.example.test/';
const htmlText = '<img src=x onerror="window.__preflightInjected=true">';
const blocker = 'SYNTHETIC-BLOCKER: consent must be reviewed in Funding.';
const id = (value: number) =>
  '00000000-0000-4000-8000-' + String(value).padStart(12, '0');

function proposal(value = 1): PreflightInboxProposal {
  return {
    id: id(value),
    missionId: id(100 + value),
    source: {
      application: 'funding-platform',
      subjectType: 'sponsorship',
      subjectId: id(200 + value),
      version: 3
    },
    type: 'sponsorship-preparation',
    risk: value % 2 === 0 ? 'normal' : 'exception',
    status: 'prepared',
    version: 1,
    createdAt: '2026-11-03T14:00:00Z',
    explanations: ['SYNTHETIC-PREPARATION-' + value, htmlText],
    limitations: ['SYNTHETIC-LIMIT: source facts require human review.'],
    blockingConditions: [blocker],
    anomalies: ['SYNTHETIC-ANOMALY: an attachment is missing.'],
    checks: [
      { resultId: id(300 + value), kind: 'source-version', passed: false }
    ],
    provenance: {
      simulated: true,
      provider: 'simulator',
      model: 'synthetic-v1'
    },
    authority: 'source_application',
    businessDecisionExecuted: false
  };
}

function inbox(
  items: readonly PreflightInboxProposal[] = [proposal()],
  page = 1,
  total = items.length
): PreflightInboxResponse {
  return {
    state: 'ready',
    consoleUrl,
    items,
    total,
    page,
    pageSize: 20,
    authority: 'source_application',
    businessDecisionExecuted: false
  };
}

type Reply = {
  status: number;
  body: PreflightInboxResponse | PreflightInboxUnavailable | { error: string };
};

async function fixtures(
  page: Page,
  language: 'fr-CA' | 'en' = 'fr-CA',
  ignoreInboxAbort = false
) {
  await prepareAdminDesignReview(page);
  await page.addInitScript(
    ({ locale, ignoreAbort, path }) => {
      localStorage.setItem('openg7.language', locale);
      if (ignoreAbort) {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const target = new URL(
            input instanceof Request ? input.url : String(input),
            window.location.href
          );
          // Deliver a response already in transit even after application cancellation.
          // This synthetic transport exercises the stale-result guards independently.
          return nativeFetch(
            input,
            target.pathname === path ? { ...init, signal: undefined } : init
          );
        };
      }
    },
    { locale: language, ignoreAbort: ignoreInboxAbort, path: endpoint }
  );
  const state = {
    signedIn: true,
    reply: (url: URL): Reply => ({
      status: 200,
      body: inbox(undefined, Number(url.searchParams.get('page') ?? '1'))
    }),
    gate: null as Promise<void> | null,
    reads: [] as URL[],
    completedReads: [] as number[],
    authorization: [] as (string | undefined)[],
    writes: [] as string[]
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      state.writes.push(request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 405, json: {} });
    }
    if (url.pathname === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (url.pathname === '/api/admin/preflight/rehearsals')
      return route.fulfill({
        json: {
          enabled: false,
          canLaunch: false,
          consoleUrl: null,
          run: null,
          runs: []
        }
      });
    if (url.pathname === '/api/admin/auth/current')
      return route.fulfill(
        state.signedIn
          ? {
              json: {
                id: 'preflight-reader-fixture',
                sessionId: 'preflight-session-fixture',
                displayName: 'Synthetic reader',
                role: 'reader',
                expiresAt: '2099-01-01T00:00:00Z'
              }
            }
          : { status: 401, json: {} }
      );
    if (url.pathname === endpoint) {
      state.reads.push(url);
      const readNumber = state.reads.length;
      state.authorization.push(request.headers()['authorization']);
      // Capture the response before the gate to simulate an older in-flight read.
      const { status, body } = state.reply(url);
      await state.gate;
      try {
        await route.fulfill({ status, json: body });
      } catch (error) {
        // Leaving the page intentionally aborts its fetch; other fixture errors fail.
        if (!request.failure()) throw error;
      } finally {
        state.completedReads.push(readNumber);
      }
      return;
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return state;
}

const view = (page: Page) => page.locator('[data-og7="admin-preflight"]');
const inboxPanel = (page: Page) => page.locator('[data-og7="preflight-inbox"]');
const proposalsTab = (page: Page) =>
  page.locator('[data-og7="preflight-workspace-tab"][data-og7-id="proposals"]');
const rows = (page: Page) => page.locator('[data-og7="preflight-proposal"]');
const refresh = (page: Page) => page.locator('[data-og7="preflight-refresh"]');

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`Preflight reader navigation and simulated proposals remain accessible in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const state = await fixtures(page, language);
      await page.goto('/admin/fundraiser');
      const sidebar = page.locator('openg7-admin-nav');
      if (width === 390) {
        const toggle = sidebar.locator(
          'button[aria-controls="admin-navigation-content"]'
        );
        await toggle.focus();
        await page.keyboard.press('Enter');
      }
      const link = sidebar.getByRole('link', {
        name: 'Preflight',
        exact: true
      });
      await expect(link).toBeVisible();
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(routePath);
      await proposalsTab(page).click();
      await expect(page).toHaveURL(base);
      await expect(view(page).getByRole('heading', { level: 1 })).toHaveText(
        'Preflight'
      );
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(inboxPanel(page)).toHaveAttribute('data-state', 'ready');
      await expect(
        page
          .locator('[data-og7="preflight-inbox"]')
          .getByRole('heading', { level: 2 })
      ).toHaveText(
        language === 'fr-CA' ? 'Propositions reçues' : 'Received proposals'
      );
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toHaveAttribute('data-og7-id', id(1));
      await expect(rows(page).first()).toContainText('SYNTHETIC-PREPARATION-1');
      await expect(rows(page).first()).toContainText(blocker);
      await expect(rows(page).first()).toContainText(/simulat/i);
      await expect(rows(page).first()).toContainText(
        language === 'fr-CA' ? 'Exception à examiner' : 'Exception to review'
      );
      await expect(rows(page).first()).toContainText(htmlText);
      await expect(
        rows(page).getByRole('button', {
          name: /approuver|approve|publier|publish|refuser|reject/i
        })
      ).toHaveCount(0);
      await expect(view(page).locator('img, script')).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            (window as Window & { __preflightInjected?: boolean })
              .__preflightInjected
        )
      ).toBeUndefined();
      const consoleLink = page.locator('[data-og7="preflight-console"]');
      await expect(consoleLink).toHaveAttribute('href', consoleUrl);
      await expect(consoleLink).toHaveAttribute('target', '_blank');
      await expect(consoleLink).toHaveAttribute('rel', /noopener/);
      const details = rows(page).first().locator('summary');
      await details.focus();
      await page.keyboard.press('Enter');
      await expect(rows(page).first()).toContainText('synthetic-v1');
      await expect(rows(page).first()).toContainText('source-version');
      await expect(refresh(page)).toBeEnabled();
      await refresh(page).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => state.reads.length).toBe(2);
      await expect(inboxPanel(page)).toHaveAttribute('data-state', 'ready');
      await expect(refresh(page)).toBeEnabled();
      expect(state.reads[0].searchParams.get('page')).toBe('1');
      expect(state.reads[0].searchParams.get('pageSize')).toBe('20');
      expect(state.authorization.every((value) => value === undefined)).toBe(
        true
      );
      expect(state.writes).toEqual([]);
      await expectAdminPageFits(page);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="admin-preflight"]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
    });
  }
}

test('Preflight distinguishes an empty connected inbox from a disabled connector', async ({
  page
}) => {
  const state = await fixtures(page);
  state.reply = () => ({ status: 200, body: inbox([]) });
  await page.goto(base);
  await expect(inboxPanel(page)).toHaveAttribute('data-state', 'ready');
  await expect(view(page)).toContainText(/aucune proposition/i);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('[data-og7="preflight-console"]')).toHaveAttribute(
    'href',
    consoleUrl
  );
  state.reply = () => ({
    status: 200,
    body: { ...inbox([]), state: 'disabled', consoleUrl: null }
  });
  await refresh(page).click();
  await expect(inboxPanel(page)).toHaveAttribute('data-state', 'disabled');
  await expect(view(page)).toContainText(/pas encore configurée/i);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('[data-og7="preflight-console"]')).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('Preflight opens proposal review details without introducing a business decision', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base);
  const examine = page
    .locator('[data-og7="preflight-proposal-examine"]')
    .first();
  await expect(examine).toBeVisible();
  await examine.focus();
  await page.keyboard.press('Enter');
  const detail = page.locator('[data-og7="preflight-proposal-detail"]');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('SYNTHETIC-PREPARATION-1');
  await expect(detail).toContainText(blocker);
  await expect(detail).toContainText('synthetic-v1');
  await expect(
    detail.getByRole('button', {
      name: /approuver|approve|publier|publish|refuser|reject/i
    })
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(detail).not.toBeVisible();
  await expect(examine).toBeFocused();
  expect(state.writes).toEqual([]);
});

test('Preflight unavailable responses hide stale proposals and recover only after a manual retry', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base);
  await expect(rows(page)).toHaveCount(1);
  state.reply = () => ({
    status: 503,
    body: {
      state: 'unavailable',
      consoleUrl,
      code: 'PREFLIGHT_UNAVAILABLE',
      error: 'Synthetic upstream connection unavailable.'
    }
  });
  await refresh(page).click();
  await expect(inboxPanel(page)).toHaveAttribute('data-state', 'unavailable');
  await expect(inboxPanel(page).getByRole('alert')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(view(page)).not.toContainText('SYNTHETIC-PREPARATION-1');
  const failedReadCount = state.reads.length;
  state.reply = () => ({ status: 200, body: inbox([proposal(2)]) });
  await expect(refresh(page)).toBeEnabled();
  expect(state.reads).toHaveLength(failedReadCount);
  await refresh(page).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toHaveAttribute('data-og7-id', id(2));
  await expect(inboxPanel(page).getByRole('alert')).toHaveCount(0);
  expect(state.reads).toHaveLength(failedReadCount + 1);
  expect(state.writes).toEqual([]);
});

test('Preflight pagination requests bounded server pages and disables duplicate refreshes', async ({
  page
}) => {
  const state = await fixtures(page);
  const firstPage = Array.from({ length: 20 }, (_, index) =>
    proposal(index + 1)
  );
  state.reply = (url) => {
    const pageNumber = Number(url.searchParams.get('page'));
    return {
      status: 200,
      body: inbox(pageNumber === 2 ? [proposal(21)] : firstPage, pageNumber, 21)
    };
  };
  await page.goto(base);
  await expect(rows(page)).toHaveCount(20);
  await expect(rows(page).nth(1)).toContainText('Risque normal');
  const previous = page.locator('[data-og7="preflight-previous"]');
  const next = page.locator('[data-og7="preflight-next"]');
  await expect(previous).toBeDisabled();
  let release!: () => void;
  state.gate = new Promise<void>((resolve) => (release = resolve));
  await next.click();
  await expect.poll(() => state.reads.length).toBe(2);
  try {
    await expect(inboxPanel(page)).toHaveAttribute('data-state', 'loading');
    await expect(rows(page)).toHaveCount(0);
    await expect(refresh(page)).toBeDisabled();
    await expect(next).toHaveCount(0);
    expect(state.reads[1].searchParams.get('page')).toBe('2');
    expect(state.reads[1].searchParams.get('pageSize')).toBe('20');
  } finally {
    state.gate = null;
    release();
  }
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toHaveAttribute('data-og7-id', id(21));
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(20);
  expect(state.reads[2].searchParams.get('page')).toBe('1');
  expect(state.writes).toEqual([]);
});

test('Preflight expired sessions clear displayed preparations and return to login', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base);
  await expect(rows(page)).toHaveCount(1);
  state.signedIn = false;
  state.reply = () => ({ status: 401, body: { error: 'Session expired.' } });
  await refresh(page).click();
  await expect(page).toHaveURL(/\/admin\/login\?/);
  const loginUrl = new URL(page.url());
  expect(loginUrl.searchParams.get('returnUrl')).toBe(base);
  await expect(view(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(
    'SYNTHETIC-PREPARATION-1'
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
  expect(state.writes).toEqual([]);
});

test('Preflight forbidden reads clear previous proposals and explain the refused access', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base);
  await expect(rows(page)).toHaveCount(1);
  state.reply = () => ({ status: 403, body: { error: 'Access refused.' } });
  await refresh(page).click();
  await expect(inboxPanel(page)).toHaveAttribute('data-state', 'forbidden');
  await expect(inboxPanel(page).getByRole('alert')).toBeVisible();
  await expect(view(page)).toContainText(/droit|autorisé|accès/i);
  await expect(rows(page)).toHaveCount(0);
  await expect(view(page)).not.toContainText('SYNTHETIC-PREPARATION-1');
  expect(state.writes).toEqual([]);
});

for (const lateStatus of [200, 401]) {
  test(`Preflight ignores a late ${lateStatus} after leaving and reopening the page`, async ({
    page
  }) => {
    const state = await fixtures(page, 'fr-CA', true);
    await page.goto(base);
    await expect(rows(page)).toHaveCount(1);
    state.reply = () => ({
      status: lateStatus,
      body:
        lateStatus === 200 ? inbox([proposal(91)]) : { error: 'Old session.' }
    });
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => (release = resolve));
    await refresh(page).click();
    await expect.poll(() => state.reads.length).toBe(2);
    try {
      await page
        .locator('openg7-admin-nav nav')
        .getByRole('link', { name: 'Cockpit', exact: true })
        .click();
      await expect(page).toHaveURL('/admin/fundraiser');
      await expect(view(page)).toHaveCount(0);
      state.gate = null;
      state.reply = () => ({ status: 200, body: inbox([proposal(2)]) });
      await page
        .locator('openg7-admin-nav nav')
        .getByRole('link', { name: 'Preflight', exact: true })
        .click();
      await proposalsTab(page).click();
      await expect(rows(page)).toHaveAttribute('data-og7-id', id(2));
    } finally {
      release();
    }
    await expect.poll(() => state.completedReads.includes(2)).toBe(true);
    await sampledFrames(page);
    await expect(rows(page)).toHaveAttribute('data-og7-id', id(2));
    await expect(view(page)).not.toContainText('SYNTHETIC-PREPARATION-91');
    await expect(page).toHaveURL(base);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('openg7-admin-session-token')
      )
    ).toBe('openg7-admin-session.cookie');
    expect(state.writes).toEqual([]);
  });
}
