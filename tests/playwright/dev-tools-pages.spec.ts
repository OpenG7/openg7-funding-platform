import type { Page } from '@playwright/test';

import type { StripeSetupDevStatus } from '../../apps/funding-web/src/app/features/funding/services/stripe-setup-dev.service.js';

import { expect, test } from './support/test.js';

// Built Web only: all API calls are intercepted, clipboard and window.open are
// recorded locally. No Stripe navigation, API process, seed or DB cleanup.
const readyStatus: StripeSetupDevStatus = {
  environment: 'development-fixture',
  apiReachable: true,
  stripeSecretKeyConfigured: true,
  stripeWebhookSecretConfigured: true,
  databaseUrlConfigured: true,
  databaseReachable: true,
  transparencySource: 'database',
  localApiBaseUrl: 'http://127.0.0.1:3333',
  checkoutEndpoint: 'http://127.0.0.1:3333/api/checkout-sessions',
  webhookEndpoint: 'http://127.0.0.1:3333/api/stripe/webhook',
  publicTransparencyEndpoint:
    'http://127.0.0.1:3333/api/public/fund-transparency',
  stripeDashboardUrl: 'https://dashboard.stripe.com/test/webhooks',
  lastCheckedAt: '2026-10-03T12:00:00.000Z'
};

type BrowserRecords = Window & {
  og7DevToolsCopies: string[];
  og7DevToolsOpens: [string, string | undefined, string | undefined][];
};

const pages = [
  {
    path: '/dev/stripe-setup',
    title: 'stripe-setup-title',
    region: 'Statuts Stripe',
    ready: 'Compte Stripe connecte',
    absent: 'Connexion Stripe a verifier',
    refresh: /Verifier la configuration/,
    columns: 4
  },
  {
    path: '/dev/webhooks',
    title: 'webhooks-title',
    region: 'Statut Webhooks',
    ready: 'Joignable',
    absent: 'A verifier',
    refresh: "Revalider l'API",
    columns: 4
  },
  {
    path: '/dev/api-keys',
    title: 'api-keys-title',
    region: 'Etat des cles Stripe',
    ready: 'Configuree cote API',
    absent: 'Manquante cote API',
    refresh: 'Revalider',
    columns: 4
  }
] as const;

async function mockStatus(page: Page, status = readyStatus): Promise<void> {
  await page.route('**/dev/stripe-setup-status', (route) =>
    route.fulfill({ json: status })
  );
}

async function copies(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as BrowserRecords).og7DevToolsCopies);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.addInitScript(() => {
    const records = window as BrowserRecords;
    records.og7DevToolsCopies = [];
    records.og7DevToolsOpens = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          records.og7DevToolsCopies.push(value);
        }
      }
    });
    window.open = (url, target, features) => {
      records.og7DevToolsOpens.push([String(url), target, features]);
      return null;
    };
  });
});

for (const diagnostic of pages) {
  test(
    diagnostic.path +
      ': initial fallback, asynchronous status, failure and retry stay read-only',
    async ({ page }) => {
      let release: () => void = () => {};
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let responseStatus = 200;
      const methods: string[] = [];
      await page.route('**/dev/stripe-setup-status', async (route) => {
        methods.push(route.request().method());
        await pending;
        await route.fulfill({ status: responseStatus, json: readyStatus });
      });
      await page.goto(diagnostic.path);
      const panel = page.getByRole('region', {
        name: diagnostic.region,
        exact: true
      });
      await expect(
        panel.getByText(diagnostic.absent, { exact: true }).first()
      ).toBeVisible();
      release();
      await expect(
        panel.getByText(diagnostic.ready, { exact: true }).first()
      ).toBeVisible();
      responseStatus = 503;
      await page.getByRole('button', { name: diagnostic.refresh }).click();
      await expect(
        panel.getByText(diagnostic.absent, { exact: true }).first()
      ).toBeVisible();
      if (diagnostic.path === '/dev/stripe-setup')
        await expect(
          page.getByText(
            'Diagnostic local indisponible. Verifiez que yarn dev tourne.',
            { exact: true }
          )
        ).toBeVisible();
      responseStatus = 200;
      await page.getByRole('button', { name: diagnostic.refresh }).click();
      await expect(
        panel.getByText(diagnostic.ready, { exact: true }).first()
      ).toBeVisible();
      if (diagnostic.path === '/dev/stripe-setup')
        await expect(
          page.getByText(
            'Diagnostic local indisponible. Verifiez que yarn dev tourne.',
            { exact: true }
          )
        ).toHaveCount(0);
      expect(methods).toEqual(['GET', 'GET', 'GET']);
    }
  );

  test(
    diagnostic.path +
      ': moved panels retain their styles and fit desktop/mobile',
    async ({ page }, testInfo) => {
      await mockStatus(page);
      await page.goto(diagnostic.path);
      await expect(page.locator('#' + diagnostic.title)).toBeVisible();
      const panel = page.getByRole('region', {
        name: diagnostic.region,
        exact: true
      });
      await expect(
        panel.getByText(diagnostic.ready, { exact: true }).first()
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      const style = await panel.evaluate((element) => {
        const grid = getComputedStyle(element);
        const card = getComputedStyle(element.querySelector('article')!);
        return {
          columns: grid.gridTemplateColumns.split(' ').length,
          padding: Number.parseFloat(card.paddingTop),
          border: Number.parseFloat(card.borderTopWidth)
        };
      });
      expect(style.columns).toBe(
        testInfo.project.name === 'mobile-chrome' ? 1 : diagnostic.columns
      );
      expect(style.padding).toBeGreaterThan(0);
      expect(style.border).toBeGreaterThan(0);
      await page.screenshot({
        path: testInfo.outputPath('panels.png'),
        fullPage: true
      });
    }
  );
}

test('setup mode, persisted steps and keyboard focus remain local', async ({
  page
}) => {
  let requests = 0;
  await page.route('**/dev/stripe-setup-status', (route) => {
    requests++;
    return route.fulfill({ json: readyStatus });
  });
  await page.goto('/dev/stripe-setup');
  const testMode = page.locator(
    '[data-og7="stripe-setup-mode"][data-og7-id="test"]'
  );
  const liveMode = page.locator(
    '[data-og7="stripe-setup-mode"][data-og7-id="live"]'
  );
  await expect(liveMode).toHaveAttribute('aria-pressed', 'true');
  await testMode.focus();
  await expect(testMode).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(testMode).toHaveAttribute('aria-pressed', 'true');
  await expect(liveMode).toHaveAttribute('aria-pressed', 'false');
  expect(
    await testMode.evaluate((element) => getComputedStyle(element).outlineStyle)
  ).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(liveMode).toBeFocused();
  await page.keyboard.press('Space');
  await expect(liveMode).toHaveAttribute('aria-pressed', 'true');
  const step = page.locator(
    '[data-og7="stripe-setup-step"][data-og7-id="install"]'
  );
  await step.focus();
  await page.keyboard.press('Space');
  await expect(step).toHaveAttribute('aria-pressed', 'true');
  const stepFocus = await step.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outline: style.outlineStyle,
      offset: Number.parseFloat(style.outlineOffset)
    };
  });
  expect(stepFocus.outline).not.toBe('none');
  expect(stepFocus.offset).toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('openg7.stripeSetup.completedSteps.v1') ?? '[]'
      )
    )
  ).toEqual(['install']);
  expect(requests).toBe(1);
  await page.reload();
  await expect(
    page.locator('[data-og7="stripe-setup-step"][data-og7-id="install"]')
  ).toHaveAttribute('aria-pressed', 'true');
});

test('setup tolerates corrupt or denied local storage', async ({ page }) => {
  await mockStatus(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('openg7.stripeSetup.completedSteps.v1', '{invalid');
    } catch {
      /* Storage denial is tested after reload. */
    }
  });
  await page.goto('/dev/stripe-setup');
  await expect(page.locator('#stripe-setup-title')).toBeVisible();
  await expect(
    page.locator('[data-og7="stripe-setup-step"][data-og7-id="install"]')
  ).toHaveAttribute('aria-pressed', 'false');
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'openg7.stripeSetup.completedSteps.v1')
        throw new Error('Fixture: storage denied');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'openg7.stripeSetup.completedSteps.v1')
        throw new Error('Fixture: storage denied');
      return setItem.call(this, key, value);
    };
  });
  await page.reload();
  const step = page.locator(
    '[data-og7="stripe-setup-step"][data-og7-id="install"]'
  );
  await step.click();
  await expect(step).toHaveAttribute('aria-pressed', 'true');
});

test('setup copies endpoints and commands and opens Stripe through the orchestrator', async ({
  page
}) => {
  await mockStatus(page);
  await page.goto('/dev/stripe-setup');
  await page.locator('[data-og7="stripe-setup-copy-endpoint"]').click();
  await expect.poll(() => copies(page)).toEqual([readyStatus.webhookEndpoint]);
  const step = page.locator(
    '[data-og7="stripe-setup-step"][data-og7-id="install"]'
  );
  const install = page.getByRole('listitem').filter({ has: step });
  await step.focus();
  await install.getByRole('button', { name: 'Copier', exact: true }).click();
  await expect
    .poll(() => copies(page))
    .toEqual([
      readyStatus.webhookEndpoint,
      'corepack enable; corepack yarn install'
    ]);
  await page.getByRole('button', { name: /Gerer le compte Stripe/ }).click();
  expect(
    await page.evaluate(() => (window as BrowserRecords).og7DevToolsOpens)
  ).toEqual([
    [readyStatus.stripeDashboardUrl, '_blank', 'noopener,noreferrer']
  ]);
});

test('webhooks preserve the event catalogue, diagnostics, copies and dashboard action', async ({
  page
}) => {
  await mockStatus(page);
  await page.goto('/dev/webhooks');
  await expect(
    page.getByText('checkout.session.completed', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Journal de diagnostics' })
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Statut Webhooks' })
      .getByText('PostgreSQL', { exact: true })
  ).toBeVisible();
  await page
    .locator('[data-og7="webhooks-copy"][data-og7-id="endpoint"]')
    .click();
  const command = page.locator('[data-og7="webhooks-command"]').first();
  const value = await command.locator('code').innerText();
  await command.getByRole('button', { name: 'Copier', exact: true }).click();
  await expect
    .poll(() => copies(page))
    .toEqual([readyStatus.webhookEndpoint, value]);
  await page.getByRole('button', { name: /Ouvrir Stripe Dashboard/ }).click();
  expect(
    await page.evaluate(() => (window as BrowserRecords).og7DevToolsOpens)
  ).toEqual([
    [readyStatus.stripeDashboardUrl, '_blank', 'noopener,noreferrer']
  ]);
});

test('API keys preserve masks, permissions, rotation and exact placeholder copies', async ({
  page
}) => {
  await mockStatus(page);
  await page.goto('/dev/api-keys');
  await expect(
    page.getByRole('heading', { name: 'Rotation securisee' })
  ).toBeVisible();
  await expect(
    page.getByText('checkout.sessions', { exact: true })
  ).toBeVisible();
  const secret = page.locator(
    '[data-og7="api-key-card"][data-og7-id="secret"]'
  );
  await expect(secret.locator('code')).toHaveText(
    'sk_live_************************'
  );
  const cardCopy = page.locator(
    '[data-og7="api-key-copy"][data-og7-id="secret"]'
  );
  await cardCopy.focus();
  await page.keyboard.press('Enter');
  await expect(cardCopy).toBeFocused();
  expect(
    await cardCopy.evaluate((element) => getComputedStyle(element).outlineStyle)
  ).not.toBe('none');
  await page
    .locator('[data-og7="api-key-command-copy"][data-og7-id="secret"]')
    .click();
  await expect
    .poll(() => copies(page))
    .toEqual([
      '$env:STRIPE_SECRET_KEY="sk_live_REMPLACE_MOI"',
      '$env:STRIPE_SECRET_KEY="sk_test_REMPLACE_MOI"'
    ]);
});

test('local diagnostic navigation preserves public links and avoids downloading admin pages', async ({
  page
}) => {
  await mockStatus(page);
  const scripts: Promise<string>[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('.js'))
      scripts.push(response.text());
  });
  await page.goto('/dev/stripe-setup');
  await page
    .getByRole('navigation', { name: 'Menu Stripe', exact: true })
    .getByRole('link', { name: /Webhooks/ })
    .click();
  await expect(page.locator('#webhooks-title')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Menu Stripe', exact: true })
    .getByRole('link', { name: /Cles API/ })
    .click();
  await expect(page.locator('#api-keys-title')).toBeVisible();
  await page.waitForLoadState('load');
  const downloaded = (await Promise.all(scripts)).join('\n');
  for (const selector of [
    'openg7-admin-nav',
    'openg7-admin-login-page',
    'openg7-admin-access-page'
  ])
    expect(downloaded).not.toContain(selector);
  // The existing compact sidebar hides its help group at these viewports.
  // Preserve the link target and exercise its public recovery route directly.
  const supportPath = await page
    .locator('a[href="/support"]')
    .getAttribute('href');
  expect(supportPath).toBe('/support');
  await page.goto(supportPath!);
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
  await page
    .getByRole('button', { name: 'Switch site language to English' })
    .click();
  await expect(page).toHaveURL(/\/en\/support$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('SSR public recovery remains readable in FR/EN and unknown routes return 404', async ({
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
      ['/support', 'fr-CA'],
      ['/en/support', 'en']
    ]) {
      expect((await page.goto(path))?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
    }
    for (const [path, language] of [
      ['/dev/page-absente', 'fr-CA'],
      ['/en/dev/stripe-setup', 'en']
    ]) {
      expect((await page.goto(path))?.status()).toBe(404);
      await expect(page.locator('[data-og7="not-found"]')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
    }
  } finally {
    await context.close();
  }
});
