import type { Locator, Page } from '@playwright/test';

import { expect, test } from './support/test.js';

type Language = 'fr-CA' | 'en';

const adminPages: {
  path: string;
  title: Record<Language, string>;
}[] = [
  {
    path: '/admin/fundraiser',
    title: { 'fr-CA': 'Centre de pilotage', en: 'Control centre' }
  },
  {
    path: '/admin/fundraiser/attention',
    title: { 'fr-CA': 'À traiter', en: 'To do' }
  },
  {
    path: '/admin/fundraiser/assistant',
    title: { 'fr-CA': 'Assistant', en: 'Assistant' }
  },
  {
    path: '/admin/fundraiser/contributions',
    title: { 'fr-CA': 'Contributions', en: 'Contributions' }
  },
  {
    path: '/admin/fundraiser/sponsors',
    title: {
      'fr-CA': 'Commanditaires / partenaires',
      en: 'Sponsors / partners'
    }
  },
  {
    path: '/admin/fundraiser/invoices',
    title: { 'fr-CA': 'Factures commandite', en: 'Sponsorship invoices' }
  },
  {
    path: '/admin/fundraiser/expenses',
    title: {
      'fr-CA': 'Depenses et allocations',
      en: 'Expenses and allocations'
    }
  },
  {
    path: '/admin/fundraiser/transparency',
    title: { 'fr-CA': 'Transparence', en: 'Transparency' }
  },
  {
    path: '/admin/fundraiser/audit',
    title: { 'fr-CA': 'Audit', en: 'Audit' }
  },
  {
    path: '/admin/fundraiser/email-queue',
    title: { 'fr-CA': 'File courriel', en: 'Email queue' }
  },
  {
    path: '/admin/fundraiser/setup',
    title: {
      'fr-CA': 'Configuration et état du système',
      en: 'Configuration and system status'
    }
  },
  {
    path: '/admin/fundraiser/access',
    title: { 'fr-CA': 'Accès et sessions', en: 'Access and sessions' }
  },
  {
    path: '/admin/fundraiser/pilotage',
    title: { 'fr-CA': 'Poste de pilotage', en: 'Control desk' }
  },
  {
    path: '/admin/fundraiser/publications',
    title: { 'fr-CA': 'Publications', en: 'Publications' }
  },
  {
    path: '/admin/fundraiser/publications/drafts',
    title: { 'fr-CA': 'Rédaction et validation', en: 'Writing and review' }
  },
  {
    path: '/admin/fundraiser/publications/batches',
    title: { 'fr-CA': 'Lots de publication', en: 'Publication batches' }
  },
  {
    path: '/admin/fundraiser/publications/calendar',
    title: { 'fr-CA': 'Calendrier éditorial', en: 'Editorial calendar' }
  },
  {
    path: '/admin/fundraiser/publications/automation',
    title: { 'fr-CA': 'Pilotage des feeds', en: 'Feed management' }
  },
  {
    path: '/admin/login',
    title: { 'fr-CA': 'Acces admin', en: 'Admin access' }
  }
];

async function fixtures(page: Page, language: Language) {
  let signedIn = true;
  const mutations: string[] = [];
  await page.addInitScript(
    (locale) => localStorage.setItem('openg7.language', locale),
    language
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      mutations.push(`${request.method()} ${pathname}`);
    }
    if (pathname === '/api/admin/auth/config') {
      return route.fulfill({ json: { mode: 'oidc' } });
    }
    if (pathname === '/api/admin/auth/current') {
      return route.fulfill(
        signedIn
          ? {
              json: {
                id: 'typography-owner',
                sessionId: 'typography-owner-session',
                displayName: 'Typography owner fixture',
                role: 'owner',
                expiresAt: '2099-01-01T00:00:00Z'
              }
            }
          : { status: 401, json: {} }
      );
    }
    // Deliberately exercise persistent headings, filters and failure states.
    // This fixture does not qualify financial rows or an actual identity provider.
    return route.fulfill({
      status: 503,
      json: { error: 'Not available in this typography UI fixture.' }
    });
  });
  return {
    mutations,
    showLogin: () => {
      signedIn = false;
    }
  };
}

async function typography(heading: Locator) {
  return heading.evaluate((element) => {
    if (!element.isConnected) throw new Error('Heading was detached.');
    const style = getComputedStyle(element);
    return {
      family: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing
    };
  });
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`all admin pages share dashboard typography in ${language} at ${width}px`, async ({
      page
    }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 1000 });
      const fixture = await fixtures(page, language);
      let dashboard: Awaited<ReturnType<typeof typography>> | undefined;
      let controlsChecked = 0;
      let buttonsChecked = 0;

      for (const { path, title } of adminPages) {
        await test.step(path, async () => {
          if (path === '/admin/login') fixture.showLogin();
          await page.goto(path);
          await expect(page).toHaveURL(path);
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          const main = page.getByRole('main');
          const heading = main.getByRole('heading', {
            level: 1,
            name: title[language],
            exact: true
          });
          // Waiting for the new localized heading prevents sampling a stale
          // heading while Angular replaces the preceding page during startup.
          await expect(heading).toBeVisible();
          await expect(heading).toHaveText(title[language]);
          const actual = await typography(heading);
          expect(actual.family).not.toBe('');
          expect(actual.size).not.toBe('');
          dashboard ??= actual;
          expect.soft(actual, `${path}: heading typography`).toEqual(dashboard);
          await expect.soft(main).toHaveCSS('font-family', dashboard.family);

          const buttons = await main
            .getByRole('button')
            .evaluateAll((elements) =>
              elements
                .filter(
                  (element) =>
                    element.getClientRects().length > 0 &&
                    (element.textContent ?? '').trim().length > 0
                )
                .map((element) => ({
                  text: (element.textContent ?? '').trim(),
                  weight: getComputedStyle(element).fontWeight,
                  family: getComputedStyle(element).fontFamily
                }))
            );
          for (const button of buttons) {
            expect
              .soft(button.weight, `${path}: button ${button.text}`)
              .toBe('600');
            expect
              .soft(button.family, `${path}: button ${button.text}`)
              .toBe(dashboard.family);
          }
          buttonsChecked += buttons.length;

          const controls = await main
            .locator('input, select, textarea')
            .evaluateAll((elements) =>
              elements
                .filter(
                  (element) =>
                    element.getClientRects().length > 0 &&
                    getComputedStyle(element).visibility !== 'hidden'
                )
                .map((element) => ({
                  name: element.getAttribute('aria-label') ?? element.tagName,
                  weight: getComputedStyle(element).fontWeight,
                  family: getComputedStyle(element).fontFamily
                }))
            );
          for (const control of controls) {
            expect
              .soft(control.weight, `${path}: field ${control.name}`)
              .toBe('400');
            expect
              .soft(control.family, `${path}: field ${control.name}`)
              .toBe(dashboard.family);
          }
          controlsChecked += controls.length;
        });
      }
      expect(buttonsChecked).toBeGreaterThan(0);
      expect(controlsChecked).toBeGreaterThan(0);
      expect(fixture.mutations).toEqual([]);
    });
  }
}
