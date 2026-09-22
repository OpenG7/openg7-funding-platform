import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  PilotCommand,
  PilotDecision,
  PilotState
} from '@openg7/funding-core';
import type { ProgrammeState } from '@openg7/funding-core';

import { test, expect } from './support/test.js';

function guide(page: Page, id = 'pilotage') {
  return page.locator(`[data-og7="admin-guide"][data-og7-id="${id}"]`);
}
function guideLaunch(page: Page, id = 'pilotage') {
  return page.locator(`[data-og7="guide-launch"][data-og7-id="${id}"]`);
}

function overviewCount(page: Page, label: string) {
  return page
    .locator('[data-og7="pilot-overview"] > div')
    .filter({ has: page.getByRole('term').filter({ hasText: label }) })
    .getByRole('definition')
    .first();
}

test('overview counts confirmed decisions and opened details for this visit only', async ({
  page
}) => {
  const { commands, hold } = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  const pending = overviewCount(page, 'À examiner');
  const done = overviewCount(page, 'décisions traitées');
  const details = overviewCount(page, 'dossiers ouverts');
  await expect(pending).toHaveText('4');
  await expect(done).toHaveText('0');
  await expect(details).toHaveText('0');
  await page.locator('[data-og7="pilot-details"]').click();
  await expect(details).toHaveText('1');
  await page.keyboard.press('Escape');
  await page.locator('[data-og7="pilot-accept"]').click();
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await expect(done).toHaveText('0');
  await page.keyboard.press('Escape');
  expect(commands).toHaveLength(0);
  await expect(pending).toHaveText('4');
  await page.locator('[data-og7="pilot-accept"]').click();
  const release = hold();
  try {
    await page.locator('[data-og7="pilot-confirm"]').click();
    await expect.poll(() => commands.length).toBe(1);
    await expect(page.locator('[data-og7="pilot-confirm"]')).toBeDisabled();
    await expect(done).toHaveText('0');
    await expect(pending).toHaveText('4');
  } finally {
    release();
  }
  await expect(done).toHaveText('1');
  await expect(pending).toHaveText('3');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toEqual({
    requestId: expect.any(String),
    action: 'publication.approve',
    targetId: '11111111-1111-4111-8111-000000000001',
    version: '1',
    confirmation: '11111111-1111-4111-8111-000000000001',
    payload: { approveSponsors: [] }
  });
  await page.reload();
  await expect(pending).toHaveText('3');
  await expect(done).toHaveText('0');
  await expect(details).toHaveText('0');
  expect(commands).toHaveLength(1);
});

for (const status of ['failed', 'uncertain'] as const) {
  test(`overview never counts a ${status} receipt as a processed decision`, async ({
    page
  }) => {
    const f = await fixtures(page);
    f.result(status);
    await page.goto('/admin/fundraiser/pilotage');
    await page.locator('[data-og7="pilot-accept"]').click();
    const response = page.waitForResponse('**/api/admin/pilotage/command');
    await page.locator('[data-og7="pilot-confirm"]').click();
    expect(await (await response).json()).toMatchObject({ status });
    await expect(
      page.locator('[data-og7="pilot-panel-confirm"]')
    ).not.toBeVisible();
    if (status === 'uncertain')
      await expect(
        page.getByRole('button', { name: 'Examiner cet incident' })
      ).toBeVisible();
    else await expect(page.locator('[data-og7="pilot-accept"]')).toBeEnabled();
    await expect(page.locator('[data-og7="pilot-receipt"]')).not.toBeVisible();
    await expect(overviewCount(page, 'décisions traitées')).toHaveText('0');
    await expect(overviewCount(page, 'À examiner')).toHaveText('4');
    expect(f.commands).toHaveLength(1);
  });
}

test('empty overview and unavailable actions remain clear in French and English', async ({
  page
}) => {
  const { commands } = await fixtures(page, 0);
  await page.goto('/admin/fundraiser/pilotage');
  await expect(overviewCount(page, 'À examiner')).toHaveText('0');
  await expect(overviewCount(page, 'décisions traitées')).toHaveText('0');
  await expect(overviewCount(page, 'dossiers ouverts')).toHaveText('0');
  await page.evaluate(() => localStorage.setItem('openg7.language', 'en'));
  await page.reload();
  await expect(overviewCount(page, 'To review')).toHaveText('0');
  await expect(overviewCount(page, 'decisions processed')).toHaveText('0');
  await expect(overviewCount(page, 'details opened')).toHaveText('0');
  await expect(page.locator('[data-og7="pilot-decision"]')).toHaveCount(0);
  for (const action of ['accept', 'reject', 'edit', 'details'])
    await expect(page.locator(`[data-og7="pilot-${action}"]`)).toBeDisabled();
  expect(commands).toEqual([]);
});

for (const width of [390, 1512]) {
  test(`actions stay reachable while scrolling and preserve keyboard confirmation at ${width}px`, async ({
    page
  }) => {
    const { commands, state } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/admin/fundraiser/pilotage');
    const card = page.locator('[data-og7="pilot-decision"]');
    await expect(card).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
    for (const progress of [0, 0.5, 1]) {
      await page.evaluate(
        (fraction) =>
          window.scrollTo({
            top:
              (document.documentElement.scrollHeight - innerHeight) * fraction,
            behavior: 'instant'
          }),
        progress
      );
      for (const action of ['accept', 'reject', 'edit', 'details']) {
        const button = page.locator(`[data-og7="pilot-${action}"]`);
        await expect(button).toBeInViewport({ ratio: 1 });
        // Visibility alone does not detect another sticky surface covering it.
        await expect
          .poll(() =>
            button.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return element.contains(
                document.elementFromPoint(
                  rect.x + rect.width / 2,
                  rect.y + rect.height / 2
                )
              );
            })
          )
          .toBe(true);
      }
    }
    const accept = page.locator('[data-og7="pilot-accept"]');
    await accept.focus();
    for (const action of ['reject', 'edit', 'details']) {
      await page.keyboard.press('Tab');
      await expect(page.locator(`[data-og7="pilot-${action}"]`)).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(
      page.locator('[data-og7="pilot-panel-details"]')
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-og7="pilot-details"]')).toBeFocused();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+Tab');
    await expect(accept).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.locator('[data-og7="pilot-panel-confirm"]')
    ).toContainText(state.decisions[0]!.title);
    expect(commands).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(accept).toBeFocused();
    await expect(card).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
  });
}

test('reduced motion keeps the mobile overview, preview and actions accessible', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  const pilotage = page.locator('[data-og7="pilotage"]');
  await expect(page.locator('[data-og7="pilot-decision"] img')).toBeVisible();
  expect(
    await pilotage.evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation.playState === 'running' &&
              Number(animation.effect?.getComputedTiming().activeDuration) > 1
          ).length
    )
  ).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .include('[data-og7="pilotage"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.locator('[data-og7="pilot-details"]').click();
  await expect(page.locator('[data-og7="pilot-panel-details"]')).toBeVisible();
});

test('guide explains real targets, resumes after reload and remembers completion without commands', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.setViewportSize({ width: 1512, height: 930 });
  await page.goto('/admin/fundraiser/pilotage');
  const tour = guide(page);
  await expect(tour).not.toBeVisible();
  await guideLaunch(page).click();
  await expect(
    tour.getByRole('button', { name: 'Précédent', exact: true })
  ).toBeDisabled();
  await expect(tour.locator('[data-og7="guide-highlight"]')).toHaveAttribute(
    'data-og7-id',
    'pilot-automation'
  );
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'automation'
  );
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour.locator('[data-og7="guide-highlight"]')).toHaveAttribute(
    'data-og7-id',
    'pilot-decision'
  );
  await tour.getByRole('button', { name: 'Précédent', exact: true }).click();
  await tour.getByRole('button', { name: 'Quitter le guide' }).click();
  await expect(guideLaunch(page)).toBeFocused();
  await expect(guideLaunch(page)).toHaveText(/Reprendre le guide/);
  await page.reload();
  await expect(tour).not.toBeVisible();
  await guideLaunch(page).click();
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  for (let i = 0; i < 8; i++)
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'J’ai compris' }).click();
  await expect(tour).not.toBeVisible();
  await page.reload();
  await expect(guideLaunch(page)).toHaveText(/Revoir le guide/);
  await guideLaunch(page).click();
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'automation'
  );
  expect(commands).toHaveLength(0);
});

test('guide owns controller shortcuts, requires release and traps keyboard focus', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  await guideLaunch(page).click();
  const tour = guide(page);
  await buttons(page);
  await buttons(page, [0]);
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  await page.waitForTimeout(600);
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  await tap(page, 2);
  await tap(page, 3);
  await page.keyboard.press('c');
  await expect(page.locator('[data-og7="admin-drawer"][open]')).toHaveCount(0);
  await tap(page, 5);
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'decision'
  );
  await tap(page, 4);
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  await page.keyboard.press('Tab');
  await expect(
    tour.getByRole('button', { name: 'Quitter le guide' })
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    tour.getByRole('button', { name: 'Suivant', exact: true })
  ).toBeFocused();
  await tap(page, 1);
  await expect(tour).not.toBeVisible();
  await expect(guideLaunch(page)).toBeFocused();
  await expect(
    page.locator('[data-og7="pilot-panel-confirm"]')
  ).not.toBeVisible();
  expect(commands).toHaveLength(0);
});

test('weekly guide opens each workspace, preserves unfinished edits and resumes inside its drawer', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  const programme = page.locator('[data-og7="editorial-programme"]');
  await programme
    .getByRole('button', { name: 'Variante de texte', exact: true })
    .click();
  await programme
    .locator('[data-og7="programme-instruction"]')
    .fill('Mon intention en cours');
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/'))
      mutations.push(request.url());
  });
  await guideLaunch(page, 'programme').click();
  const tour = guide(page, 'programme');
  await expect(tour.locator('[data-og7="guide-highlight"]')).toHaveAttribute(
    'data-og7-id',
    'programme-brief'
  );
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour.locator('[data-og7="guide-highlight"]')).toHaveAttribute(
    'data-og7-id',
    'programme-compose'
  );
  await page.keyboard.press('Escape');
  await expect(tour).not.toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Ma semaine', exact: true })
  ).toBeVisible();
  await expect(
    programme.locator('[data-og7="programme-instruction"]')
  ).toHaveValue('Mon intention en cours');
  await expect(guideLaunch(page, 'programme')).toBeFocused();
  await page.keyboard.press('Escape');
  await f.open();
  await expect(guideLaunch(page, 'programme')).toHaveText(/Reprendre le guide/);
  await guideLaunch(page, 'programme').click();
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'calendar'
  );
  for (const id of ['rehearsal', 'editorial', 'memory', 'incidents']) {
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
    await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
      'data-og7-id',
      id
    );
    await expect(tour.locator('[data-og7="guide-highlight"]')).toBeVisible();
  }
  await tour.getByRole('button', { name: 'J’ai compris' }).click();
  await expect(programme).toBeVisible();
  expect(mutations).toEqual([]);
  expect(f.commands).toEqual([]);
});

test('guide is translated, accessible and stays in the viewport on mobile and resize', async ({
  page
}) => {
  await fixtures(page);
  await page.addInitScript(() => localStorage.setItem('openg7.language', 'en'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser/pilotage');
  await guideLaunch(page).click();
  const tour = guide(page);
  await expect(
    tour.getByRole('heading', { name: 'Check what the machine is preparing' })
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('[data-og7="admin-guide"][open]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1512, height: 930 }
  ]) {
    await page.setViewportSize(size);
    const card = tour.locator('[data-og7="guide-card"]');
    await expect(async () => {
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    }).toPass();
    await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(tour.locator('[data-og7="guide-highlight"]')).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/guide-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(async () => {
    const target = (await page
      .locator('[data-og7="pilot-summary"]')
      .boundingBox())!;
    const ring = (await tour
      .locator('[data-og7="guide-highlight"]')
      .boundingBox())!;
    expect(Math.abs(ring.y - Math.max(6, target.y - 5))).toBeLessThan(2);
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y).toBeLessThan(400);
  }).toPass();
  await page.screenshot({ path: 'test-results/guide-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(guideLaunch(page)).toBeFocused();
});

test('guide handles empty readonly state, unavailable storage and stale saved step', async ({
  page
}) => {
  const f = await fixtures(page, 0);
  f.state.writable = false;
  await page.addInitScript(() => {
    localStorage.setItem(
      'og7-admin-guide:v1:token:pilotage',
      JSON.stringify({ step: 'removed-step', completed: false })
    );
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('og7-admin-guide:'))
        throw new DOMException('Storage disabled', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.goto('/admin/fundraiser/pilotage');
  await expect(guideLaunch(page)).toHaveText(/Guide pas à pas/);
  await guideLaunch(page).click();
  const tour = guide(page);
  await expect(tour).toContainText(
    'Le navigateur ne permet pas de sauvegarder'
  );
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tour).toContainText('Cet élément n’est pas affiché');
  await expect(tour.locator('[data-og7="guide-highlight"]')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await guideLaunch(page).click();
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'decision'
  );
  expect(f.commands).toEqual([]);
});

test('guide progress is isolated between named administrator accounts', async ({
  page
}) => {
  const f = await fixtures(page);
  f.state.writable = false;
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.cookie'
    )
  );
  let account = 'guide-reader-a';
  await page.route('**/admin/auth/current', (route) =>
    route.fulfill({
      json: {
        id: account,
        displayName: 'Guide reader',
        role: 'reader',
        expiresAt: '2099-01-01T00:00:00Z'
      }
    })
  );
  await page.goto('/admin/fundraiser/pilotage');
  await guideLaunch(page).click();
  await guide(page)
    .getByRole('button', { name: 'Suivant', exact: true })
    .click();
  await page.keyboard.press('Escape');
  account = 'guide-reader-b';
  await page.reload();
  await expect(guideLaunch(page)).toHaveText(/Guide pas à pas/);
  await guideLaunch(page).click();
  await expect(guide(page).locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'automation'
  );
  await page.keyboard.press('Escape');
  account = 'guide-reader-a';
  await page.reload();
  await expect(guideLaunch(page)).toHaveText(/Reprendre le guide/);
  await guideLaunch(page).click();
  await expect(guide(page).locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  expect(f.commands).toEqual([]);
});

async function fixtures(page: Page, count = 4) {
  const commands: PilotCommand[] = [];
  const state: PilotState = {
    generatedAt: '2026-09-21T12:00:00Z',
    coverage: 'complete',
    missingSources: [],
    total: count,
    page: 1,
    pageSize: 30,
    domains: {
      publications: count,
      sponsors: 0,
      email: 0,
      invoices: 0,
      contributions: 0,
      projects: 0,
      operations: 0
    },
    feeds: [],
    workerEnabled: true,
    writable: true,
    decisions: []
  };
  state.decisions = Array.from({ length: count }, (_, i): PilotDecision => {
    const id = `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`;
    return {
      id: 'publication:' + id,
      domain: 'publications',
      kind: 'publication_draft',
      targetId: id,
      version: '1',
      title: i
        ? 'Un avenir commun — projet ' + (i + 1)
        : 'Ensemble, bâtissons les projets de demain.',
      severity: 'this_week',
      dueAt: '2030-09-22T13:00:00Z',
      detailsUrl: '/admin/fundraiser/publications/automation?deliveryId=' + id,
      facts: [{ label: 'destination', value: 'openg7:facebook' }],
      actions: [
        { id: 'publication.approve', blocked: null },
        { id: 'publication.reject', blocked: null },
        { id: 'publication.edit', blocked: null }
      ],
      publication: {
        id,
        feedId: 'openg7:facebook',
        kind: 'news',
        batchId: null,
        message: i
          ? 'Le projet ' + (i + 1) + ' vous remercie.'
          : 'Ensemble, bâtissons les projets de demain.\nMerci aux entreprises qui font avancer nos communautés.',
        scheduledAt: '2030-09-22T13:00:00Z',
        mediaId: '22222222-2222-4222-8222-222222222222',
        mediaUrl: null,
        mediaAlt: 'Communautés connectées au Canada',
        accountId: 'fixture-page',
        mode: 'mock',
        autoManaged: true,
        sponsors: [],
        version: 1,
        status: 'draft',
        attempts: 0,
        nextAttemptAt: null,
        externalPostId: null,
        externalPostUrl: null,
        errorCode: null,
        approvedAt: null,
        publishedAt: null
      }
    };
  });
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
    const pad = {
      id: 'Test standard controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
      axes: [0, 0, 0, 0]
    };
    (window as unknown as { fixturePad: typeof pad }).fixturePad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
  });
  const photo = await readFile(
    'apps/funding-web/src/assets/openg7-social-communautes-connectees-canada-960.webp'
  );
  const results = new Map<string, object>();
  let fail = false;
  let commandGate: Promise<void> | undefined;
  let status: 'completed' | 'failed' | 'uncertain' = 'completed';
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/media/content/'))
      return route.fulfill({ contentType: 'image/webp', body: photo });
    if (url.pathname.endsWith('/pilotage/receipt')) {
      if (route.request().method() === 'POST') {
        const c = route.request().postDataJSON() as { requestId: string };
        const reviewed = {
          ...results.get(c.requestId),
          reviewedAt: new Date().toISOString()
        };
        results.set(c.requestId, reviewed);
        return route.fulfill({ json: reviewed });
      }
      return route.fulfill({
        json: results.get(url.searchParams.get('id')!) ?? {}
      });
    }
    if (url.pathname.endsWith('/pilotage/command')) {
      const c = route.request().postDataJSON() as PilotCommand;
      commands.push(c);
      await commandGate;
      const r = {
        requestId: c.requestId,
        action: c.action,
        targetId: c.targetId,
        status,
        code:
          status !== 'completed'
            ? 'RESULT_UNKNOWN'
            : c.action === 'publication.approve'
              ? 'SCHEDULED'
              : c.action === 'publication.reject'
                ? 'REJECTED'
                : 'SAVED'
      };
      results.set(c.requestId, r);
      if (status === 'completed' && c.action === 'publication.edit') {
        const d = state.decisions.find((d) => d.targetId === c.targetId)!;
        d.version = String(Number(d.version) + 1);
        d.title = c.payload!.message!;
        d.publication!.message = c.payload!.message!;
        d.publication!.scheduledAt = c.payload!.scheduledAt!;
      } else if (status === 'completed')
        state.decisions = state.decisions.filter(
          (d) => d.targetId !== c.targetId
        );
      state.total = state.decisions.length;
      state.domains.publications = state.total;
      if (fail) return route.abort('failed');
      return route.fulfill({ json: r });
    }
    if (url.pathname.endsWith('/pilotage'))
      return route.fulfill({
        json: {
          ...state,
          decisions: state.decisions.filter(
            (d) =>
              (!url.searchParams.get('id') ||
                d.id === url.searchParams.get('id')) &&
              (!url.searchParams.get('domain') ||
                d.domain === url.searchParams.get('domain'))
          )
        }
      });
    if (url.pathname.endsWith('/publication-automation'))
      return route.fulfill({
        json: {
          workerEnabled: true,
          feeds: [],
          deliveries: state.decisions.map((d) => d.publication),
          summary: {
            awaitingApproval: state.total,
            scheduled: 0,
            exceptions: 0,
            publishedToday: 0
          }
        }
      });
    return route.fulfill({ status: 503, json: {} });
  });
  return {
    state,
    commands,
    hold: () => {
      let release!: () => void;
      commandGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    uncertain: () => {
      status = 'uncertain';
    },
    result: (value: typeof status) => {
      status = value;
    },
    fail: () => {
      fail = true;
    }
  };
}
async function buttons(page: Page, pressed: number[] = []): Promise<void> {
  await page.evaluate((indices) => {
    const pad = (
      window as unknown as {
        fixturePad: { buttons: { value: number; pressed: boolean }[] };
      }
    ).fixturePad;
    pad.buttons.forEach((b, i) => {
      b.value = indices.includes(i) ? 1 : 0;
      b.pressed = !!b.value;
    });
  }, pressed);
  await page.waitForTimeout(70);
}
async function tap(page: Page, button: number): Promise<void> {
  await buttons(page);
  await buttons(page, [button]);
  await buttons(page);
}

test('controller approval is contextual, requires release and processes twenty decisions without the portal', async ({
  page
}) => {
  const { commands } = await fixtures(page, 20);
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('[data-og7="pilot-decision"]')).toBeVisible();
  await buttons(page);
  await buttons(page, [0]);
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await page.waitForTimeout(600);
  expect(commands).toHaveLength(0);
  await buttons(page);
  await buttons(page, [0]);
  await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  await page.waitForTimeout(400);
  expect(commands).toHaveLength(1);
  for (let i = 1; i < 20; i++) {
    await tap(page, 5);
    await tap(page, 0);
    await expect(
      page.locator('[data-og7="pilot-panel-confirm"]')
    ).toBeVisible();
    await tap(page, 0);
    await expect.poll(() => commands.length).toBe(i + 1);
    await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  }
  expect(new Set(commands.map((c) => c.targetId)).size).toBe(20);
  expect(new Set(commands.map((c) => c.requestId)).size).toBe(20);
  expect(
    commands.every(
      (c) => c.action === 'publication.approve' && c.confirmation === c.targetId
    )
  ).toBe(true);
  await expect(page).toHaveURL(/\/pilotage$/);
});
test('details, edit, rejection, calendar chord and return preserve decision context', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  const card = page.locator('[data-og7="pilot-decision"]');
  await expect(card).toBeVisible();
  const id = await card.getAttribute('data-og7-id');
  await tap(page, 3);
  await expect(page.locator('[data-og7="pilot-panel-details"]')).toBeVisible();
  await tap(page, 1);
  await expect(card).toHaveAttribute('data-og7-id', id!);
  await tap(page, 2);
  await page
    .locator('[data-og7="pilot-message"]')
    .fill('Texte révisé avant envoi.');
  await page.getByRole('button', { name: '+ 30 min', exact: true }).click();
  await page.locator('[data-og7="pilot-save"]').click();
  await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  expect(commands[0]!.payload?.message).toBe('Texte révisé avant envoi.');
  expect(commands[0]!.payload?.scheduledAt).toBe('2030-09-22T13:30:00.000Z');
  await page.getByRole('button', { name: /Relire le dossier/ }).click();
  await expect(card).toContainText('Texte révisé');
  await buttons(page);
  await buttons(page, [6, 3]);
  await expect(page.locator('[data-og7="pilot-panel-calendar"]')).toBeVisible();
  await buttons(page, [3]);
  await buttons(page);
  await tap(page, 1);
  await tap(page, 1);
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await tap(page, 0);
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]!.action).toBe('publication.reject');
});
test('lost response recovers its receipt without replaying a command, including after reload', async ({
  page
}) => {
  const f = await fixtures(page);
  f.fail();
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-accept"]').click();
  await page.locator('[data-og7="pilot-confirm"]').click();
  await expect(
    page.getByRole('button', { name: 'Vérifier le résultat' })
  ).toBeVisible();
  await expect(page.locator('#admin-main')).toBeFocused();
  expect(f.commands).toHaveLength(1);
  await page.reload();
  await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  expect(f.commands).toHaveLength(1);
  await expect(overviewCount(page, 'décisions traitées')).toHaveText('1');
  await expect(overviewCount(page, 'À examiner')).toHaveText('3');
  await page.reload();
  await expect(overviewCount(page, 'décisions traitées')).toHaveText('0');
  expect(f.commands).toHaveLength(1);
});
test('stable snapshot blocks stale decisions; focus, accessibility and narrow screen remain usable', async ({
  page
}) => {
  const { state, commands } = await fixtures(page);
  await page.setViewportSize({ width: 1512, height: 930 });
  await page.clock.install();
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('[data-og7="pilot-decision"] img')).toBeVisible();
  await page.screenshot({
    path: 'test-results/pilotage-desktop.png',
    fullPage: true
  });
  const results = await new AxeBuilder({ page })
    .include('[data-og7="pilotage"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.locator('[data-og7="pilot-details"]').click();
  await expect(page.locator('[data-og7="pilot-panel-details"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="pilot-details"]')).toBeFocused();
  state.decisions[0]!.version = '2';
  state.decisions[0]!.title = 'Changed after review started';
  await page.clock.fastForward(31000);
  await expect(
    page.getByRole('button', { name: 'Relire le dossier' })
  ).toBeVisible();
  await expect(page.locator('[data-og7="pilot-decision"]')).not.toContainText(
    'Changed after review started'
  );
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeDisabled();
  expect(commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Relire le dossier' }).click();
  await expect(page.locator('[data-og7="pilot-decision"]')).toContainText(
    'Changed after review started'
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/pilotage-mobile.png',
    fullPage: true
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test('uncertain command is acknowledged after investigation without another mutation', async ({
  page
}) => {
  const f = await fixtures(page);
  f.uncertain();
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-accept"]').click();
  await page.locator('[data-og7="pilot-confirm"]').click();
  await page.getByRole('button', { name: 'Examiner cet incident' }).click();
  const save = page.getByRole('button', {
    name: 'Consigner mon constat et reprendre le pilotage'
  });
  await expect(save).toBeDisabled();
  await page
    .getByLabel('Constat après vérification du dossier et de l’audit')
    .fill(
      'Dossier et audit vérifiés, aucune publication externe supplémentaire.'
    );
  await save.click();
  await expect(
    page.getByRole('button', { name: 'Vérifier le résultat' })
  ).toHaveCount(0);
  expect(f.commands).toHaveLength(1);
  await tap(page, 5);
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeEnabled();
});

test('settings validate remapping and unknown controller input remains inert', async ({
  page
}) => {
  const f = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Réglages de la manette' })
    .click();
  await page.getByLabel('Accepter / sélectionner').selectOption({ label: 'B' });
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('bouton distinct');
  await page
    .getByRole('button', { name: 'Rétablir le profil initial' })
    .click();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.evaluate(() => {
    (
      window as unknown as { fixturePad: { mapping: string } }
    ).fixturePad.mapping = '';
  });
  await buttons(page, [0]);
  await buttons(page);
  expect(f.commands).toHaveLength(0);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: /Calibration requise/ })
  ).toBeVisible();
});

async function programmeFixtures(page: Page) {
  const fixture = await fixtures(page, 3);
  const date = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(13, 0, 0, 0);
    return d.toISOString();
  };
  fixture.state.decisions.forEach((d, i) => {
    d.publication!.scheduledAt = date(i + 1);
    d.publication!.message =
      'Merci à Atelier ' +
      (i + 1) +
      '\n\nLe projet avance. Ensemble, nous avançons.\n\nCommandite rémunérée.';
  });
  const programme: ProgrammeState = {
    generatedAt: new Date().toISOString(),
    version: 'programme-v1',
    complete: true,
    writable: true,
    feeds: [
      {
        id: 'openg7:facebook',
        paused: true,
        autoPrepare: true,
        timezone: 'America/Toronto',
        weekdays: [1, 4],
        localTime: '09:00',
        capacity: 5,
        horizonDays: 14,
        mode: 'mock',
        accountId: 'fixture',
        configured: true,
        connection: 'ready',
        checkedAt: null,
        expiresAt: null
      }
    ],
    profiles: [
      {
        feedId: 'openg7:facebook',
        version: 1,
        preferences: [],
        observations: { neutral: 3 }
      }
    ],
    deliveries: fixture.state.decisions.map((d) => d.publication!),
    issues: [],
    briefing: { ready: 3, scheduled: 0, blocked: 0, coveredUntil: null }
  };
  await page.route('**/pilotage/programme', async (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({
        json: {
          version: programme.version,
          plan: {
            moves: programme.deliveries.slice(0, 2).map((d, i) => ({
              id: d.id,
              version: d.version,
              scheduledAt: date(i + 5)
            })),
            warnings: [],
            emptySlots: []
          }
        }
      });
    return route.fulfill({ json: programme });
  });
  await page.route('**/pilotage/variant', async (route) => {
    const input = route.request().postDataJSON();
    const d = programme.deliveries.find((d) => d.id === input.id)!;
    if (!['neutral', 'Ton neutre'].includes(input.instruction))
      return route.fulfill({
        status: 400,
        json: { code: 'INTENT_NOT_SUPPORTED' }
      });
    return route.fulfill({
      json: {
        intent: 'neutral',
        before: d.message,
        after: d.message.replace('Merci à', 'Partenaire :'),
        deliveryId: d.id,
        version: d.version,
        feedId: d.feedId
      }
    });
  });
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('[data-og7="pilot-decision"]')).toBeVisible();
  const open = async () => {
    await page.locator('[data-og7="open-programme"]').click();
    await expect(
      page.locator('[data-og7="editorial-programme"]')
    ).toBeVisible();
  };
  return { ...fixture, programme, open };
}

test('weekly briefing starts and resumes a five-minute session without mutating publications', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await expect(
    page.getByRole('heading', { name: 'Les décisions qui comptent maintenant' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'J’ai cinq minutes' }).click();
  await expect(page.getByText(/Session de cinq minutes/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Session de cinq minutes/)).toBeVisible();
  expect(f.commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Terminer la session' }).click();
  await expect(page.getByText(/Session de cinq minutes/)).toHaveCount(0);
});

test('weekly calendar and rehearsal show proposed changes before a controller confirmation', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await page
    .getByRole('button', { name: 'Composer la semaine', exact: true })
    .click();
  await buttons(page);
  await page.evaluate(() => {
    document.querySelector('dialog[open]')!.scrollTop = 0;
    (
      window as unknown as { fixturePad: { axes: number[] } }
    ).fixturePad.axes[3] = 0.9;
  });
  await expect
    .poll(() => page.locator('dialog[open]').evaluate((d) => d.scrollTop))
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    (
      window as unknown as { fixturePad: { axes: number[] } }
    ).fixturePad.axes[3] = 0;
  });
  await page.getByRole('button', { name: 'Proposer une répartition' }).click();
  await expect(page.locator('[data-og7="programme-moves"] li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Voir le déroulement' }).click();
  await expect(page.locator('[data-og7="programme-rehearsal"]')).toContainText(
    'Merci à Atelier'
  );
  await page
    .getByRole('button', { name: 'Publication suivante', exact: true })
    .click();
  expect(f.commands).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Composer la semaine', exact: true })
    .click();
  await page.getByRole('button', { name: 'Examiner les déplacements' }).click();
  await expect(
    page.locator('[data-og7="programme-confirmation"]')
  ).toContainText('nouvelle approbation');
  await page
    .getByRole('button', { name: 'Confirmer l’enregistrement' })
    .focus();
  await buttons(page);
  await buttons(page, [0]);
  await page.waitForTimeout(500);
  expect(f.commands).toHaveLength(1);
  expect(f.commands[0]!.action).toBe('programme.apply');
  expect(f.commands[0]!.payload!.moves).toHaveLength(2);
  await buttons(page);
});

test('weekly variants require review and recover a lost command response without a replay', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await page
    .getByRole('button', { name: 'Variante de texte', exact: true })
    .click();
  await page.getByRole('button', { name: 'Ton neutre', exact: true }).click();
  await expect(page.locator('[data-og7="programme-comparison"]')).toContainText(
    'Partenaire : Atelier'
  );
  expect(f.commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Examiner cette variante' }).click();
  f.fail();
  await page
    .getByRole('button', { name: 'Confirmer l’enregistrement' })
    .click();
  await expect.poll(() => f.commands.length).toBe(1);
  await page.reload();
  await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  expect(f.commands).toHaveLength(1);
  expect(f.commands[0]!.payload!.editorialIntent).toBe('neutral');
});

test('weekly memory and incident solutions remain explicit reviewed commands', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  const d = f.programme.deliveries[2]!;
  f.programme.issues = [
    {
      deliveryId: d.id,
      codes: ['CONSENT_WITHDRAWN'],
      excludedSponsorIds: ['withdrawn'],
      repair: {
        version: 'repair-v1',
        message: 'Merci au commanditaire admissible.\n\nCommandite rémunérée.',
        scheduledAt: d.scheduledAt,
        sponsors: [{ id: 'retained', name: 'Atelier admissible' }],
        removed: ['withdrawn'],
        added: []
      }
    }
  ];
  await f.open();
  await page.getByRole('button', { name: 'Préférences', exact: true }).click();
  await expect(
    page.getByText('Cette correction revient régulièrement.', { exact: false })
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'Ton neutre' }).check();
  expect(f.commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Examiner mes préférences' }).click();
  await page
    .getByRole('button', { name: 'Confirmer l’enregistrement' })
    .click();
  await expect.poll(() => f.commands.length).toBe(1);
  expect(f.commands[0]!.action).toBe('editorial.preferences');
  await f.open();
  await page
    .getByRole('button', { name: 'Résoudre les incidents', exact: true })
    .click();
  await expect(
    page.getByText('Le consentement de publication a été retiré.')
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Examiner cette recomposition' })
    .click();
  await page
    .getByRole('button', { name: 'Confirmer l’enregistrement' })
    .click();
  await expect.poll(() => f.commands.length).toBe(2);
  expect(f.commands[1]!.action).toBe('publication.repair');
});

test('weekly views expose errors, readonly coverage and accessible responsive calendar', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await page
    .getByRole('button', { name: 'Variante de texte', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Mon intention' })
    .fill('Publier sans revue');
  await page
    .getByRole('button', { name: 'Préparer la variante', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('quatre transformations');
  await page
    .getByRole('button', { name: 'Composer la semaine', exact: true })
    .click();
  await page.screenshot({
    path: 'test-results/programme-desktop.png',
    fullPage: true
  });
  const axe = await new AxeBuilder({ page })
    .include('[data-og7="editorial-programme"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/programme-mobile.png',
    fullPage: true
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  f.programme.complete = false;
  f.programme.writable = false;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(
    page.getByText('La projection est incomplète.', { exact: false })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Proposer une répartition' })
  ).toBeDisabled();
  expect(f.commands).toHaveLength(0);
});
