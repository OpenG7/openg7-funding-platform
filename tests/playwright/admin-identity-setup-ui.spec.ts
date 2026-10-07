import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type { AdminSetupStatusResponse } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';
import { setupFixture } from './support/setup-fixtures.js';

const guide = (page: Page) => page.locator('[data-og7="identity-setup"]');
const current = (page: Page) =>
  page.locator('[data-og7="identity-current-step"]');

async function installOwnerFixtures(page: Page) {
  const data: {
    setup: AdminSetupStatusResponse;
    status: number;
    writes: number;
    setupAuthorization: string | undefined;
  } = {
    setup: setupFixture(),
    status: 200,
    writes: 0,
    setupAuthorization: undefined
  };
  const systems = cockpitFixtures();
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') data.writes++;
    if (path.endsWith('/admin/auth/current'))
      return route.fulfill({
        json: {
          id: 'synthetic-owner',
          sessionId: 'synthetic-session',
          displayName: 'Example owner',
          role: 'owner',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (path.endsWith('/setup-status')) {
      data.setupAuthorization = request.headers()['authorization'];
      return route.fulfill({
        status: data.status,
        json: data.status === 200 ? data.setup : {}
      });
    }
    if (path.endsWith('/cockpit/systems'))
      return route.fulfill({ json: systems.systems });
    if (path.endsWith('/cockpit/activity'))
      return route.fulfill({ json: systems.activity });
    return route.fulfill({ status: 503, json: {} });
  });
  return data;
}

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1600]) {
    test(`public OIDC guide works before sign-in with the API unavailable in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((locale) => {
        localStorage.setItem('openg7.language', locale);
      }, language);
      let requests = 0;
      await page.route('**/api/**', async (route) => {
        requests++;
        await route.fulfill({ status: 503, json: {} });
      });
      await page.goto('/admin/oidc-setup');
      const root = page.locator('[data-og7="identity-setup-page"]');
      await expect(root.getByRole('heading', { level: 1 })).toContainText(
        'OIDC'
      );
      await expect(guide(page)).toBeVisible();
      await expect(current(page)).toHaveAttribute('data-og7-id', 'provider');
      await expect(
        page.locator('[data-og7="identity-configuration"]')
      ).toHaveCount(0);
      await expect(
        page.locator('[data-og7="identity-step-previous"]')
      ).toBeDisabled();
      await page.locator('[data-og7="identity-step-next"]').focus();
      await page.keyboard.press('Enter');
      await expect(current(page)).toHaveAttribute('data-og7-id', 'client');
      await expect(
        page.locator('[data-og7="identity-step-heading"]')
      ).toBeFocused();
      await expect(current(page)).toContainText(
        'https://<site>/api/admin/auth/callback'
      );
      await page
        .locator('[data-og7="identity-step-link"][data-og7-id="environment"]')
        .click();
      await expect(current(page)).toContainText(
        'FUNDING_ADMIN_OIDC_CLIENT_SECRET'
      );
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await page
        .locator('[data-og7="identity-step-link"][data-og7-id="mfa"]')
        .click();
      await expect(
        current(page).locator('[data-state="manual"]')
      ).toBeVisible();
      await page
        .locator('[data-og7="identity-step-link"][data-og7-id="verification"]')
        .click();
      await expect(
        page.locator('[data-og7="identity-step-next"]')
      ).toBeDisabled();
      await expect(
        root.locator('[data-og7="identity-setup-sign-in"]')
      ).toHaveAttribute(
        'href',
        '/admin/login?returnUrl=%2Fadmin%2Ffundraiser%2Fsetup%3Fsection%3Didentity'
      );
      expect(requests).toBe(0);
      expect(
        await root.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1
        )
      ).toBe(true);
      const accessibility = await new AxeBuilder({ page })
        .include('[data-og7="identity-setup-page"]')
        .analyze();
      expect(accessibility.violations).toEqual([]);
    });
  }

  test(`verification instructions lead to OIDC sign-in in ${language}`, async ({
    page
  }) => {
    await page.addInitScript((locale) => {
      localStorage.setItem('openg7.language', locale);
    }, language);
    let writes = 0;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') writes++;
      if (new URL(request.url()).pathname.endsWith('/admin/auth/config'))
        return route.fulfill({ json: { mode: 'oidc' } });
      return route.fulfill({ status: 401, json: {} });
    });
    await page.goto('/admin/oidc-setup');
    await page
      .locator('[data-og7="identity-step-link"][data-og7-id="verification"]')
      .click();
    await expect(current(page)).toHaveAttribute('data-og7-id', 'verification');
    await expect(current(page)).toContainText('/admin/fundraiser');
    const prescribedPath = (await current(page).innerText()).match(
      /\/admin(?:\/[\w-]+)*/
    )?.[0];
    expect(prescribedPath).toBe('/admin/fundraiser');

    const response = await page.goto(prescribedPath!);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/login\?/);
    expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(
      prescribedPath
    );
    const signIn = page.locator('[data-og7="identity-sign-in"]');
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute(
      'href',
      '/api/admin/auth/start?returnUrl=%2Fadmin%2Ffundraiser'
    );
    expect(writes).toBe(0);
  });
}

test.describe('prerendered OIDC guide', () => {
  test.use({ javaScriptEnabled: false });
  test('public instructions remain readable without JavaScript or an API', async ({
    page,
    request
  }) => {
    const response = await request.get('/admin/oidc-setup');
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('data-og7="identity-setup-page"');
    await page.goto('/admin/oidc-setup');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('OIDC');
    await guide(page).locator('details summary').click();
    await expect(guide(page).locator('details')).toContainText('PKCE');
    await expect(guide(page).locator('details')).toContainText('MFA');
  });
});

test('login links to the guide even when the authentication API is unavailable', async ({
  page
}) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.goto('/admin/login');
  await page.locator('[data-og7="identity-setup-link"]').click();
  await expect(page).toHaveURL(/\/admin\/oidc-setup$/);
  await expect(guide(page)).toBeVisible();
});

test('OIDC owner sees configuration guidance while MFA and provider checks remain manual', async ({
  page
}) => {
  const data = await installOwnerFixtures(page);
  await page.goto('/admin/fundraiser/setup?section=identity');
  await expect(page.locator('#setup-identity')).toBeFocused();
  await expect(guide(page).locator('[data-state="configured"]')).toBeVisible();
  await expect(
    page.locator('[data-og7="identity-configuration"]')
  ).toContainText('https://example.test/api/admin/auth/callback');
  await page
    .locator('[data-og7="identity-step-link"][data-og7-id="mfa"]')
    .click();
  await expect(current(page).locator('[data-state="manual"]')).toBeVisible();
  await expect(
    page.locator('[data-og7="identity-access-link"]')
  ).toHaveAttribute('href', '/admin/fundraiser/access');
  expect(data.setupAuthorization).toBeUndefined();
  expect(data.writes).toBe(0);
});

test('legacy API, token mode and incomplete OIDC configuration never show a completed identity diagnostic', async ({
  page
}) => {
  const data = await installOwnerFixtures(page);
  const configuredIdentity = data.setup.identity!;
  data.setup = { ...data.setup, identity: undefined };
  await page.goto('/admin/fundraiser/setup?section=identity');
  await expect(guide(page).locator('[data-state="unknown"]')).toBeVisible();
  await expect(
    page.locator('[data-og7="identity-not-observed"]')
  ).toBeVisible();
  data.setup = {
    ...data.setup,
    identity: { ...configuredIdentity, mode: 'token' }
  };
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.locator('[data-og7="identity-token-mode"]')).toBeVisible();
  data.setup = {
    ...data.setup,
    identity: { ...configuredIdentity, client_secret_configured: false }
  };
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(guide(page).locator('[data-state="incomplete"]')).toBeVisible();
  expect(data.writes).toBe(0);
});

test('failed or forbidden refresh removes the previous identity diagnostics', async ({
  page
}) => {
  const data = await installOwnerFixtures(page);
  await page.goto('/admin/fundraiser/setup?section=identity');
  await expect(
    page.locator('[data-og7="identity-configuration"]')
  ).toBeVisible();
  data.status = 503;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.locator('[data-og7="identity-configuration"]')).toHaveCount(
    0
  );
  data.status = 403;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.locator('[data-og7="identity-configuration"]')).toHaveCount(
    0
  );
  await expect(
    page.locator('[data-og7="admin-setup"]').getByRole('alert')
  ).toBeVisible();
  expect(data.writes).toBe(0);
});
