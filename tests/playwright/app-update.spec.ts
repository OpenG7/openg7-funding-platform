import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, sampledFrames, test } from './support/test.js';

const noticeSelector = '[data-og7="app-update-notice"]';

async function installUpdateFixture(page: Page) {
  const originalHtml = await readFile(
    resolve('dist/apps/funding-web/browser/index.csr.html'),
    'utf8'
  );
  const state = {
    html: originalHtml,
    status: 200,
    fail: false,
    checks: 0,
    waitForResponse: null as Promise<void> | null
  };
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.route('**/index.csr.html', async (route) => {
    state.checks++;
    if (state.waitForResponse) await state.waitForResponse;
    if (state.fail) return route.abort('failed');
    return route.fulfill({
      status: state.status,
      contentType: 'text/html',
      body: state.html
    });
  });
  return { state, originalHtml };
}

function changedAsset(html: string, asset: 'main' | 'styles', version: string) {
  const extension = asset === 'main' ? 'js' : 'css';
  const updated = html.replace(
    new RegExp(`${asset}-[a-z0-9]+\\.${extension}`, 'gi'),
    `${asset}-${version}.${extension}`
  );
  expect(updated).not.toBe(html);
  return updated;
}

async function checkOnEvent(
  page: Page,
  state: { checks: number },
  event: 'online' | 'visibilitychange' = 'online'
) {
  const previousChecks = state.checks;
  await page.evaluate((name) => {
    if (name === 'visibilitychange') document.dispatchEvent(new Event(name));
    else window.dispatchEvent(new Event(name));
  }, event);
  await expect.poll(() => state.checks).toBeGreaterThan(previousChecks);
  await sampledFrames(page);
}

test('unchanged, unavailable and invalid versions stay silent, then checks recover', async ({
  page
}) => {
  const { state, originalHtml } = await installUpdateFixture(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/support');
  await expect.poll(() => state.checks).toBe(1);
  await sampledFrames(page);
  await expect(page.locator(noticeSelector)).toHaveCount(0);

  state.fail = true;
  await checkOnEvent(page, state);
  await expect(page.locator(noticeSelector)).toHaveCount(0);

  state.fail = false;
  state.status = 503;
  state.html = changedAsset(originalHtml, 'main', 'SYNTHETICB');
  await checkOnEvent(page, state);
  await expect(page.locator(noticeSelector)).toHaveCount(0);

  state.status = 200;
  state.html =
    '<!doctype html><html><body>Temporarily unavailable</body></html>';
  await checkOnEvent(page, state);
  await expect(page.locator(noticeSelector)).toHaveCount(0);

  state.html = changedAsset(originalHtml, 'main', 'SYNTHETICB');
  await checkOnEvent(page, state);
  await expect(page.locator(noticeSelector)).toBeVisible();
  expect(errors).toEqual([]);
});

test('returning to a visible tab detects a new main bundle without navigating or taking focus', async ({
  page
}) => {
  const { state, originalHtml } = await installUpdateFixture(page);
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await page.goto('/support?draft=synthetic#keep-draft');
  await expect.poll(() => state.checks).toBe(1);
  const focusedLink = page.locator('main a[href]').first();
  await focusedLink.focus();
  await expect(focusedLink).toBeFocused();
  const previousNavigations = navigations;
  state.html = changedAsset(originalHtml, 'main', 'SYNTHETICB');

  await checkOnEvent(page, state, 'visibilitychange');
  await expect(page.locator(noticeSelector)).toBeVisible();
  await expect(focusedLink).toBeFocused();
  await expect(page).toHaveURL(/\/support\?draft=synthetic#keep-draft$/);
  expect(navigations).toBe(previousNavigations);
});

test('periodic checks detect a stylesheet deployment without a main bundle change', async ({
  page
}) => {
  const { state, originalHtml } = await installUpdateFixture(page);
  await page.clock.install();
  await page.goto('/support');
  await expect.poll(() => state.checks).toBe(1);
  state.html = changedAsset(originalHtml, 'styles', 'SYNTHETICB');

  await page.clock.fastForward(60_001);
  await expect.poll(() => state.checks).toBeGreaterThan(1);
  await expect(page.locator(noticeSelector)).toBeVisible();
});

test('hidden and offline tabs defer checks and repeated events share a pending request', async ({
  page
}) => {
  const { state, originalHtml } = await installUpdateFixture(page);
  await page.goto('/support');
  await expect.poll(() => state.checks).toBe(1);
  await sampledFrames(page);
  state.html = changedAsset(originalHtml, 'main', 'SYNTHETICB');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
  });
  await sampledFrames(page);
  expect(state.checks).toBe(1);
  await expect(page.locator(noticeSelector)).toHaveCount(0);

  await page.evaluate(() => Reflect.deleteProperty(document, 'hidden'));
  await page.context().setOffline(true);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
  });
  await sampledFrames(page);
  expect(state.checks).toBe(1);
  await expect(page.locator(noticeSelector)).toHaveCount(0);

  let respond!: () => void;
  state.waitForResponse = new Promise<void>((resolve) => {
    respond = resolve;
  });
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => state.checks).toBe(2);
  await page.evaluate(() => {
    for (let index = 0; index < 3; index++) {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });
  await sampledFrames(page);
  expect(state.checks).toBe(2);
  await expect(page.locator(noticeSelector)).toHaveCount(0);

  respond();
  state.waitForResponse = null;
  await expect(page.locator(noticeSelector)).toBeVisible();
  state.html = changedAsset(originalHtml, 'main', 'SYNTHETICC');
  await checkOnEvent(page, state);
  expect(state.checks).toBe(3);
});

test('Later hides only the detected version and a subsequent deployment is announced', async ({
  page
}) => {
  const { state, originalHtml } = await installUpdateFixture(page);
  await page.goto('/en/support');
  await expect.poll(() => state.checks).toBe(1);
  state.html = changedAsset(originalHtml, 'main', 'SYNTHETICB');
  await checkOnEvent(page, state);
  await expect(page.locator(noticeSelector)).toBeVisible();
  await page.locator('[data-og7="app-update-later"]').click();
  await expect(page.locator(noticeSelector)).toHaveCount(0);

  await checkOnEvent(page, state);
  await expect(page.locator(noticeSelector)).toHaveCount(0);

  state.html = changedAsset(originalHtml, 'main', 'SYNTHETICC');
  await checkOnEvent(page, state);
  await expect(page.locator(noticeSelector)).toBeVisible();
});

for (const locale of [
  {
    path: '/support',
    language: 'fr-CA',
    title: 'Nouvelle version disponible',
    refresh: 'Rafraîchir',
    later: 'Plus tard'
  },
  {
    path: '/en/support',
    language: 'en',
    title: 'A new version is available',
    refresh: 'Refresh',
    later: 'Later'
  }
]) {
  test(`the update action is localized, accessible and fits the viewport (${locale.language})`, async ({
    page
  }) => {
    const { state, originalHtml } = await installUpdateFixture(page);
    state.html = changedAsset(originalHtml, 'main', 'SYNTHETICB');
    await page.goto(locale.path);
    const notice = page.locator(noticeSelector);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(locale.title);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.language);
    const refresh = notice.getByRole('button', {
      name: locale.refresh,
      exact: true
    });
    const later = notice.getByRole('button', {
      name: locale.later,
      exact: true
    });
    const previousFocus = page.locator('main a[href]').first();
    await previousFocus.focus();
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(later).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    const scan = await new AxeBuilder({ page })
      .include(noticeSelector)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(notice).toHaveCount(0);
    await expect(previousFocus).toBeFocused();
  });
}

test('Refresh reloads only on request and preserves the route, query and fragment', async ({
  page
}) => {
  const { state, originalHtml } = await installUpdateFixture(page);
  await page.goto('/en/support?draft=synthetic#keep-draft');
  await expect.poll(() => state.checks).toBe(1);
  state.html = changedAsset(originalHtml, 'main', 'SYNTHETICB');
  await checkOnEvent(page, state);
  const refresh = page.locator('[data-og7="app-update-refresh"]');
  await expect(refresh).toBeVisible();
  state.html = originalHtml;

  const loaded = page.waitForEvent('load');
  await refresh.click();
  await loaded;
  await expect(page).toHaveURL(/\/en\/support\?draft=synthetic#keep-draft$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (
          performance.getEntriesByType(
            'navigation'
          )[0] as PerformanceNavigationTiming
        ).type
    )
  ).toBe('reload');
  await expect(page.locator(noticeSelector)).toHaveCount(0);
});
