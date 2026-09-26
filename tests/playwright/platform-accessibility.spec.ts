import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';

test('a secondary public route avoids the home page code, then navigates to the localized home', async ({
  page
}) => {
  const scripts: Promise<string>[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('.js'))
      scripts.push(response.text());
  });
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.goto('/en/support');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('load');
  expect((await Promise.all(scripts)).join('\n')).not.toContain(
    'openg7-funding-page'
  );
  await page.locator('a[href="/en/fonds-des-batisseurs"]').first().click();
  await expect(page).toHaveURL(/\/en\/fonds-des-batisseurs$/);
  await expect(page.locator('openg7-funding-page')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('lazy home remains readable without JavaScript in both languages', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL
  });
  try {
    const page = await context.newPage();
    for (const [path, language] of [
      ['/fonds-des-batisseurs', 'fr-CA'],
      ['/en/fonds-des-batisseurs', 'en']
    ]) {
      expect((await page.goto(path))?.status()).toBe(200);
      await expect(page.locator('openg7-funding-page h1')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
    }
  } finally {
    await context.close();
  }
});

test('the public entry does not download administrative page implementations', async ({
  page
}) => {
  const scripts: Promise<string>[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('.js'))
      scripts.push(response.text());
  });
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.goto('/fonds-des-batisseurs');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('load');
  const downloaded = (await Promise.all(scripts)).join('\n');
  expect(downloaded.length).toBeGreaterThan(10000);
  for (const selector of [
    'openg7-admin-nav',
    'openg7-admin-login-page',
    'openg7-admin-access-page'
  ])
    expect(downloaded).not.toContain(selector);
});

for (const language of ['fr-CA', 'en']) {
  test(`404 preserves HTTP status, language and accessible recovery: ${language}`, async ({
    page
  }) => {
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 503, json: {} })
    );
    const response = await page.goto(
      language === 'en' ? '/en/absent-page' : '/page-absente'
    );
    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-og7="not-found"]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, follow'
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    const link = page.locator('[data-og7="not-found"] a').first();
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      language === 'en'
        ? /\/en\/fonds-des-batisseurs$/
        : /\/fonds-des-batisseurs$/
    );
    await expect(
      page.locator('meta[name="robots"][content*="noindex"]')
    ).toHaveCount(0);
  });
}

test('identity sign-in and owner access are accessible and session revocation needs confirmation', async ({
  page
}) => {
  let signedIn = false;
  let logouts = 0;
  const mutations: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/config'))
      return route.fulfill({ json: { mode: 'oidc' } });
    if (path.endsWith('/auth/logout')) {
      logouts++;
      signedIn = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/auth/current'))
      return route.fulfill(
        signedIn
          ? {
              json: {
                id: 'owner',
                sessionId: 'session',
                displayName: 'Test Owner',
                role: 'owner',
                expiresAt: '2099-01-01T00:00:00Z'
              }
            }
          : { status: 401, json: {} }
      );
    if (path.endsWith('/access')) {
      if (route.request().method() === 'POST') {
        mutations.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({
        json: {
          accounts: [
            {
              id: 'owner',
              subject: 'fixture-owner',
              displayName: 'Test Owner',
              role: 'owner',
              disabled: false
            }
          ],
          sessions: [
            {
              id: 'session',
              accountId: 'owner',
              createdAt: '2026-09-19T12:00:00Z'
            }
          ]
        }
      });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/admin/login');
  await expect(page.locator('[data-og7="identity-sign-in"]')).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  signedIn = true;
  await page.goto('/admin/fundraiser/access');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Accès et sessions'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  await page.screenshot({
    path: `test-results/admin-access-${test.info().project.name}.png`,
    fullPage: true
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  await page
    .getByRole('button', { name: 'Révoquer la session', exact: true })
    .click();
  expect(mutations).toHaveLength(0);
  await page
    .getByRole('group', { name: 'Révoquer la session' })
    .getByRole('button', { name: 'Révoquer la session' })
    .click();
  await expect.poll(() => mutations.length).toBe(1);
  expect(mutations[0]).toEqual({
    sessionId: 'session',
    confirmation: 'session'
  });
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBe('openg7-admin-session.cookie');
  // Even an expired browser marker must revoke the server-side cookie session.
  await page.evaluate(() =>
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2000-01-01T00:00:00Z'
    )
  );
  const menu = page.locator('button[aria-controls="admin-navigation-content"]');
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
  await expect.poll(() => logouts).toBe(1);
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test('admin cockpit is accessible at desktop and narrow widths, including its error state', async ({
  page
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.a11y-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  });
  const data = cockpitFixtures();
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/admin/cockpit/'))
      return route.fulfill({
        json: data[path.split('/').pop() as keyof typeof data]
      });
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/admin/fundraiser');
  await expect(page.locator('[data-og7="cockpit-metrics"]')).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
});
