import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';
import { installPublicFinancialAccessibilityFixtures } from './support/public-financial-accessibility.js';

async function auditPublicFinancialAccessibility(
  page: import('@playwright/test').Page,
  selector: string,
  state: string
) {
  const scan = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  await test.info().attach(`financial-accessibility-${state}`, {
    body: JSON.stringify(scan),
    contentType: 'application/json'
  });
  expect(scan.violations).toEqual([]);
}

for (const locale of [
  {
    prefix: '',
    language: 'fr-CA',
    personal: /Contribution personnelle/i,
    sponsorship: /Commandite d'entreprise/i,
    displayName: /Afficher mon nom publiquement/i,
    acknowledgment: /OpenG7 est un projet indépendant en développement/i,
    transparencyError: 'Impossible de charger la transparence publique.'
  },
  {
    prefix: '/en',
    language: 'en',
    personal: /Personal contribution/i,
    sponsorship: /Business sponsorship/i,
    displayName: /Display my name publicly/i,
    acknowledgment: /OpenG7 is an independent project in development/i,
    transparencyError: 'Unable to load public transparency.'
  }
]) {
  for (const contribution of ['personal', 'sponsorship'] as const) {
    test(`financial accessibility: ${contribution} form, validation and checkout error (${locale.language})`, async ({
      page
    }) => {
      const state = await installPublicFinancialAccessibilityFixtures(page);
      await page.goto(`${locale.prefix}/fonds-des-batisseurs`);
      await expect(page.locator('html')).toHaveAttribute(
        'lang',
        locale.language
      );
      const form = page.locator('[data-og7="contribution-form"]');
      const type = form.getByRole('button', { name: locale[contribution] });
      await expect(type).toBeEnabled();
      await type.click();
      await expect(type).toHaveAttribute('aria-pressed', 'true');
      const amount = form.locator('#custom-contribution');
      await amount.fill(contribution === 'sponsorship' ? '50' : '25');
      await form.getByRole('checkbox', { name: locale.displayName }).check();
      const name = form.locator('#public-display-name');
      await name.fill('Synthetic public contributor');
      await form.getByRole('checkbox', { name: locale.acknowledgment }).check();
      if (contribution === 'sponsorship')
        await form.locator('[data-og7="offer-acceptance"]').check();
      const submit = form.locator('button[type="submit"]');
      await expect(submit).toBeEnabled();
      await form.scrollIntoViewIfNeeded();
      await auditPublicFinancialAccessibility(
        page,
        '[data-og7="contribution-form"]',
        'valid'
      );

      await amount.fill('-50');
      await name.fill('');
      await expect(amount).toHaveAttribute('aria-invalid', 'true');
      await expect(amount).toHaveAttribute(
        'aria-describedby',
        'custom-contribution-help'
      );
      await expect(name).toHaveAttribute('aria-invalid', 'true');
      await expect(name).toHaveAttribute(
        'aria-describedby',
        'public-display-name-help'
      );
      await expect(form.locator('#custom-contribution-help')).toBeVisible();
      await expect(form.locator('#public-display-name-help')).toBeVisible();
      await expect(submit).toBeDisabled();
      expect(state.checkouts).toBe(0);
      await auditPublicFinancialAccessibility(
        page,
        '[data-og7="contribution-form"]',
        'invalid'
      );

      await amount.fill(contribution === 'sponsorship' ? '50' : '25');
      await name.fill('Synthetic public contributor');
      if (contribution === 'sponsorship')
        await form.locator('[data-og7="offer-acceptance"]').check();
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect.poll(() => state.checkouts).toBe(1);
      await expect(form.getByRole('alert')).toBeVisible();
      await auditPublicFinancialAccessibility(
        page,
        '[data-og7="contribution-form"]',
        'checkout-error'
      );
    });
  }

  for (const response of ['data', 'error'] as const) {
    test(`financial accessibility: public transparency ${response} (${locale.language})`, async ({
      page
    }) => {
      const state = await installPublicFinancialAccessibilityFixtures(page);
      state.transparencyUnavailable = response === 'error';
      await page.goto(`${locale.prefix}/fonds-des-batisseurs/transparence`);
      await expect(page.locator('html')).toHaveAttribute(
        'lang',
        locale.language
      );
      const main = page.locator('main');
      const exportButton = main.locator('[data-og7="transparency-json"]');
      if (response === 'data') {
        await expect(exportButton).toBeEnabled();
        await expect(main.getByRole('progressbar')).toHaveAttribute(
          'aria-valuenow',
          '50'
        );
        await expect(
          main.locator('[data-og7="published-allocations"]')
        ).toContainText('Synthetic public project');
      } else {
        await expect(
          main.locator('[data-og7="transparency-status"]')
        ).toHaveText(locale.transparencyError);
        await expect(exportButton).toBeDisabled();
        await expect(
          main.locator('[data-og7="transparency-totals"] strong')
        ).toHaveText(['—', '—', '—', '—']);
        await expect(
          main.locator('[data-og7="transparency-refresh"]')
        ).toBeEnabled();
      }
      await auditPublicFinancialAccessibility(page, 'main', response);
      expect(state.checkouts).toBe(0);
    });
  }
}

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
  // Capture the first rendered frame after focus, before a smooth scroll can
  // eventually make a confirmation visible and conceal a moving click target.
  const confirmationFocus = await page.evaluateHandle(() => {
    const state = {
      bounds: null as { top: number; bottom: number; viewport: number } | null
    };
    const captureFocus = (event: FocusEvent) => {
      const target = event.target;
      if (
        !(target instanceof HTMLButtonElement) ||
        !target.closest('[role="group"]')
      )
        return;
      document.removeEventListener('focusin', captureFocus);
      requestAnimationFrame(() => {
        const bounds = target.getBoundingClientRect();
        state.bounds = {
          top: bounds.top,
          bottom: bounds.bottom,
          viewport: innerHeight
        };
      });
    };
    document.addEventListener('focusin', captureFocus);
    return state;
  });
  await page
    .getByRole('button', { name: 'Révoquer la session', exact: true })
    .click();
  expect(mutations).toHaveLength(0);
  await expect
    .poll(() => confirmationFocus.evaluate((state) => state.bounds))
    .not.toBeNull();
  const focusedBounds = await confirmationFocus.evaluate(
    (state) => state.bounds!
  );
  // Scroll offsets may round to whole pixels while DOM bounds are fractional.
  expect(focusedBounds.top).toBeGreaterThanOrEqual(-1);
  expect(focusedBounds.bottom).toBeLessThanOrEqual(focusedBounds.viewport + 1);
  await confirmationFocus.dispose();
  await expect(
    page
      .getByRole('group', { name: 'Révoquer la session' })
      .getByRole('button', { name: 'Révoquer la session' })
  ).toBeFocused();
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

test('administration remains usable when persistent browser storage is unavailable', async ({
  page
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage is unavailable', 'SecurityError');
      }
    });
  });
  const data = cockpitFixtures();
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/config'))
      return route.fulfill({ json: { mode: 'token' } });
    if (path.endsWith('/auth/current'))
      return route.fulfill({ status: 401, json: {} });
    if (path.endsWith('/admin/session'))
      return route.fulfill({
        json: {
          sessionToken: 'openg7-admin-session.storage-fixture',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (path.startsWith('/api/admin/cockpit/'))
      return route.fulfill({
        json: data[path.split('/').pop() as keyof typeof data]
      });
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Acces admin'
  );
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Admin access'
  );
  await page.locator('input[type="password"]').fill('synthetic-root-token');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/fundraiser$/);
  await expect(page.locator('[data-og7="cockpit-metrics"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(errors).toEqual([]);
});

test('an invalid saved session expiry returns to sign-in without authenticated requests', async ({
  page
}) => {
  const authenticatedRequests: string[] = [];
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.invalid-expiry-fixture'
    );
    sessionStorage.setItem('openg7-admin-session-expires-at', 'invalid-date');
  });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().headers()['authorization'])
      authenticatedRequests.push(path);
    if (path.endsWith('/auth/config'))
      return route.fulfill({ json: { mode: 'token' } });
    return route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/admin/fundraiser');
  await expect(page).toHaveURL(/\/admin\/login\?/);
  await expect(page.locator('input[type="password"]')).toBeVisible();
  expect(authenticatedRequests).toEqual([]);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
});
