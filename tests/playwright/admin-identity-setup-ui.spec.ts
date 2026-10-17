import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type { AdminSetupStatusResponse } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';
import { setupFixture } from './support/setup-fixtures.js';
import {
  blockAdminReviewWrites,
  captureAdminDesign,
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';

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

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`identity owner composition preserves configuration and manual checks in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 864 });
      await prepareAdminDesignReview(page);
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      const data = await installOwnerFixtures(page);
      const writes = await blockAdminReviewWrites(page);
      await page.goto('/admin/fundraiser/setup?section=identity');
      await expect(
        guide(page).locator('[data-og7="identity-configuration-state"]')
      ).toHaveAttribute('data-state', 'configured');
      await captureAdminDesign(page, testInfo, `identity-owner-${width}`);
      const mfa = guide(page).locator(
        '[data-og7="identity-step-link"][data-og7-id="mfa"]'
      );
      await page.keyboard.press('Tab');
      await mfa.focus();
      await mfa.press('Enter');
      await expect(
        guide(page).locator('[data-og7="identity-step-heading"]')
      ).toBeFocused();
      await expect(
        current(page).locator('[data-state="manual"]')
      ).toBeVisible();
      if (language === 'en')
        await page.evaluate(
          () => (document.documentElement.style.fontSize = '32px')
        );
      await guide(page)
        .locator('[data-og7="identity-step-link"][data-og7-id="environment"]')
        .click();
      await expect(current(page)).toContainText(
        'FUNDING_ADMIN_OIDC_CLIENT_SECRET'
      );
      await expectAdminPageFits(page);
      for (const button of await guide(page)
        .getByRole('navigation')
        .getByRole('button')
        .all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(data.writes).toBe(0);
      expect(writes).toEqual([]);
    });

    test(`login composition keeps OIDC and local token controls readable in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 864 });
      await prepareAdminDesignReview(page);
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      let mode: 'oidc' | 'token' = 'oidc';
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/auth/config'))
          return route.fulfill({ json: { mode } });
        return route.fulfill({ status: 401, json: {} });
      });
      const writes = await blockAdminReviewWrites(page);
      await page.goto('/admin/login?returnUrl=%2Fadmin%2Ffundraiser%2Fsetup');
      const signIn = page.locator('[data-og7="identity-sign-in"]');
      await expect(signIn).toHaveAttribute(
        'href',
        '/api/admin/auth/start?returnUrl=%2Fadmin%2Ffundraiser%2Fsetup'
      );
      await page.keyboard.press('Tab');
      await signIn.focus();
      await expect(signIn).toHaveCSS('outline-width', '3px');
      await expect(signIn).toBeFocused();
      expect((await signIn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await captureAdminDesign(page, testInfo, `login-oidc-${width}`);
      mode = 'token';
      await page.goto('/admin/login?sessionExpired=1');
      const token = page.locator('input[type="password"]');
      await expect(token).toBeVisible();
      await expect(page.getByRole('status')).toContainText(
        language === 'en'
          ? 'expired or been revoked'
          : 'expiré ou a été révoquée'
      );
      await token.fill('synthetic-preview-not-submitted');
      await page.keyboard.press('Tab');
      const submit = page.locator('button[type="submit"]');
      await expect(submit).toBeFocused();
      await expect(submit).toBeEnabled();
      await captureAdminDesign(page, testInfo, `login-token-${width}`);
      if (language === 'en')
        await page.evaluate(
          () => (document.documentElement.style.fontSize = '32px')
        );
      await expectAdminPageFits(page);
      for (const control of [
        token,
        submit,
        page.locator('[data-og7="identity-setup-link"]')
      ]) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(writes).toEqual([]);
    });
  }
}

const identityPalettes = {
  mineral: {
    panel: 'rgb(255, 255, 255)',
    border: 'rgb(216, 224, 236)',
    text: 'rgb(23, 43, 80)',
    muted: 'rgb(82, 98, 123)',
    raised: 'rgb(240, 244, 249)',
    selected: 'rgb(237, 243, 250)',
    focus: 'rgb(53, 106, 159)'
  },
  night: {
    panel: 'rgb(20, 35, 56)',
    border: 'rgb(64, 86, 111)',
    text: 'rgb(241, 245, 252)',
    muted: 'rgb(189, 203, 224)',
    raised: 'rgb(27, 45, 68)',
    selected: 'rgb(36, 61, 83)',
    focus: 'rgb(158, 218, 255)'
  },
  graphite: {
    panel: 'rgb(37, 41, 47)',
    border: 'rgb(86, 97, 110)',
    text: 'rgb(243, 244, 246)',
    muted: 'rgb(196, 203, 213)',
    raised: 'rgb(50, 56, 65)',
    selected: 'rgb(56, 67, 79)',
    focus: 'rgb(194, 227, 255)'
  }
} as const;

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  for (const { language, width } of [
    { language: 'fr-CA', width: 390 },
    { language: 'en', width: 1536 }
  ]) {
    test(`identity guide owner styles retain ${theme} palettes in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(
        ({ language, theme }) => {
          localStorage.setItem('openg7.language', language);
          localStorage.setItem(
            'openg7.pilotage.appearance.v1',
            JSON.stringify({ theme, system: false, density: 'comfortable' })
          );
        },
        { language, theme }
      );
      const data = await installOwnerFixtures(page);
      await page.goto('/admin/fundraiser/setup?section=identity');
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        theme
      );
      const panel = guide(page);
      const palette = identityPalettes[theme];
      await expect(panel).toBeVisible();
      await expect(panel).toHaveCSS('background-color', palette.panel);
      await expect(panel).toHaveCSS('background-image', 'none');
      await expect(panel).toHaveCSS('border-top-color', palette.border);
      await expect(panel).toHaveCSS('border-top-width', '1px');
      await expect(panel).toHaveCSS('border-radius', '14px');
      await expect(panel).toHaveCSS('padding', '20px');
      const configuration = panel.locator(
        '[data-og7="identity-configuration"]'
      );
      const steps = panel.getByRole('navigation').getByRole('list');
      for (const grid of [configuration, steps]) {
        await expect(grid).toHaveCSS('display', 'grid');
        await expect
          .poll(() =>
            grid.evaluate(
              (element) =>
                getComputedStyle(element).gridTemplateColumns.split(/\s+/)
                  .length
            )
          )
          .toBe(width <= 700 ? 1 : 2);
      }
      await expect(configuration).toHaveCSS('gap', '16px');
      await expect(steps).toHaveCSS('gap', '8px');
      await expect(configuration.locator('dt').first()).toHaveCSS(
        'color',
        palette.muted
      );
      await expect(configuration.locator('dt').first()).toHaveCSS(
        'font-size',
        '14px'
      );
      const observation = panel.locator(
        '[data-og7="identity-configuration-state"]'
      );
      await expect(observation).toHaveAttribute('data-state', 'configured');
      await expect(observation).toHaveCSS('background-color', palette.raised);
      await expect(observation).toHaveCSS('font-size', '14px');
      const provider = panel.locator(
        '[data-og7="identity-step-link"][data-og7-id="provider"]'
      );
      const client = panel.locator(
        '[data-og7="identity-step-link"][data-og7-id="client"]'
      );
      await expect(provider).toHaveAttribute('aria-current', 'step');
      await expect(provider).toHaveCSS('background-color', palette.selected);
      await expect(provider).toHaveCSS('border-top-color', palette.focus);
      await expect(client).toHaveCSS('background-color', palette.panel);
      await expect(client).toHaveCSS('color', palette.text);
      await expect(client).toHaveCSS('min-height', '44px');
      await expect(client).toHaveCSS('padding', '10px 16px');
      await expect(client).toHaveCSS('border-radius', '10px');
      await client.focus();
      await page.keyboard.press('Enter');
      await expect(current(page)).toHaveAttribute('data-og7-id', 'client');
      const heading = panel.locator('[data-og7="identity-step-heading"]');
      await expect(heading).toBeFocused();
      await expect(heading).toHaveCSS('outline-width', '3px');
      await expect(heading).toHaveCSS('outline-color', palette.focus);
      await expect(current(page).locator('code')).toHaveCSS('display', 'block');
      await expect(current(page).locator('code')).toHaveCSS(
        'overflow-wrap',
        'anywhere'
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(data.writes).toBe(0);
    });
  }
}

test('public identity guide adapts to its own width without authentication or API reads', async ({
  page
}) => {
  await page.setViewportSize({ width: 701, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('openg7.language', 'en');
  });
  const requests: string[] = [];
  await page.route('**/api/**', (route) => {
    requests.push(
      `${route.request().method()} ${new URL(route.request().url()).pathname}`
    );
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/admin/oidc-setup');
  const root = page.locator('[data-og7="identity-setup-page"]');
  await expect(root).toHaveCSS('min-height', '1000px');
  await expect(root.locator(':scope > div')).toHaveCSS('max-width', '1024px');
  const steps = guide(page).getByRole('navigation').getByRole('list');
  const selected = guide(page).locator(
    '[data-og7="identity-step-link"][aria-current="step"]'
  );
  await expect(guide(page)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(selected).toHaveCSS('background-color', 'rgb(220, 233, 218)');
  await expect(selected).toHaveCSS('color', 'rgb(41, 51, 46)');
  await expect(
    guide(page).locator('[data-og7="identity-all-steps"] summary')
  ).toHaveCSS('color', 'rgb(53, 107, 82)');
  const guideLinks = guide(page).locator('footer').getByRole('link');
  await expect(guideLinks).toHaveCount(3);
  for (const link of await guideLinks.all())
    await expect(link).toHaveCSS('color', 'rgb(53, 107, 82)');
  for (const width of [699, 700, 701, 730, 731, 732]) {
    await page.setViewportSize({ width, height: 1000 });
    const available = (await page
      .locator('openg7-admin-identity-setup')
      .boundingBox())!.width;
    await expect
      .poll(() =>
        steps.evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(/\s+/).length
        )
      )
      .toBe(available >= 42 * 16 ? 2 : 1);
    await expect(guide(page)).toHaveCSS('padding', '20px');
    await expect(guide(page)).toHaveCSS('border-radius', '14px');
    expect(
      await root.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1
      )
    ).toBe(true);
  }
  await expect(page.locator('[data-og7="identity-configuration"]')).toHaveCount(
    0
  );
  const next = page.locator('[data-og7="identity-step-next"]');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(current(page)).toHaveAttribute('data-og7-id', 'client');
  await expect(current(page)).toContainText(
    'https://<site>/api/admin/auth/callback'
  );
  await expect(selected).toHaveAttribute('data-og7-id', 'client');
  await expect(selected).toHaveCSS('background-color', 'rgb(220, 233, 218)');
  const signIn = root.locator('[data-og7="identity-setup-sign-in"]');
  await expect(signIn).toHaveCSS('text-decoration-line', 'underline');
  await expect(signIn).toHaveCSS('text-underline-offset', '3.2px');
  expect(requests).toEqual([]);
});

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1536]) {
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
      // The public guide is prerendered. Wait for Angular to attach its
      // handlers before exercising the focused button with Enter.
      const setup = page.locator('openg7-admin-identity-setup');
      await expect(setup).toBeVisible();
      await expect(setup).not.toHaveAttribute('ngh');
      const next = page.locator('[data-og7="identity-step-next"]');
      await expect(next).toBeEnabled();
      await next.focus();
      await expect(next).toBeFocused();
      await next.press('Enter');
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
    // Wait for the browser locale and the guide's translated control before
    // interacting with the prerendered step controls.
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const verification = page.locator(
      '[data-og7="identity-step-link"][data-og7-id="verification"]'
    );
    await expect(verification).toContainText(
      language === 'en'
        ? 'Verify sign-in, roles and revocation'
        : 'Vérifier connexion, rôles et révocation'
    );
    await verification.click();
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
