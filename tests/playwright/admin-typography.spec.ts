import type { Locator, Page } from '@playwright/test';

import { expect, test } from './support/test.js';
import {
  expectAdminFontsReady,
  expectLocalAdminFonts,
  fontFamilies,
  watchFontRequests
} from './support/admin-fonts.js';

type Language = 'fr-CA' | 'en';

const adminPages: {
  path: string;
  title: Record<Language, string>;
  compactSectionHeadings?: { selector: string; count: number };
}[] = [
  {
    path: '/admin/fundraiser',
    title: { 'fr-CA': 'Centre de pilotage', en: 'Control centre' },
    compactSectionHeadings: {
      selector:
        '[data-og7="dashboard-workflow"] [data-og7="sponsorship-progress"] > header > h2',
      count: 1
    }
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
    title: { 'fr-CA': 'Publications', en: 'Publications' },
    compactSectionHeadings: {
      selector: '[data-og7="publication-space"] h2',
      count: 3
    }
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
  for (const width of [390, 1280, 1536]) {
    test(`all admin pages share dashboard typography in ${language} at ${width}px`, async ({
      page
    }) => {
      test.setTimeout(60000);
      await page.setViewportSize({
        width,
        height: width === 1536 ? 864 : 1000
      });
      const fixture = await fixtures(page, language);
      const fontRequests = watchFontRequests(page);
      let dashboard: Awaited<ReturnType<typeof typography>> | undefined;
      let bodyFamily: string | undefined;
      let controlsChecked = 0;
      let buttonsChecked = 0;

      for (const { path, title, compactSectionHeadings } of adminPages) {
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
          await expect
            .poll(async () =>
              fontFamilies((await typography(heading)).family).slice(0, 2)
            )
            .toEqual(['Sora', 'Inter']);
          await expectAdminFontsReady(page);
          const actual = await typography(heading);
          expect(actual.weight).toBe('600');
          expect(Number.parseFloat(actual.size)).toBeCloseTo(
            Math.min(30, Math.max(26, 20 + width * 0.006)),
            2
          );
          expect(Number.parseFloat(actual.letterSpacing)).toBeCloseTo(
            Number.parseFloat(actual.size) * -0.02,
            3
          );
          dashboard ??= actual;
          expect.soft(actual, `${path}: heading typography`).toEqual(dashboard);
          const currentBodyFamily = await main.evaluate(
            (element) => getComputedStyle(element).fontFamily
          );
          bodyFamily ??= currentBodyFamily;
          expect(fontFamilies(currentBodyFamily).slice(0, 2)).toEqual([
            'Inter',
            'Segoe UI'
          ]);
          await expect.soft(main).toHaveCSS('font-family', bodyFamily);
          // Compact dossier labels and publication navigation titles explicitly
          // use the body face. Other section headings retain the Sora contract.
          const nestedHeadings = await main
            .locator('h2, h3, h4, h5, h6')
            .evaluateAll(
              (elements, compactSelector) =>
                elements
                  .filter((element) => element.getClientRects().length > 0)
                  .map((element) => ({
                    tag: element.tagName,
                    text: (element.textContent ?? '').trim(),
                    family: getComputedStyle(element).fontFamily,
                    compact:
                      compactSelector !== null &&
                      element.matches(compactSelector)
                  })),
              compactSectionHeadings?.selector ?? null
            );
          expect(
            nestedHeadings.filter((heading) => heading.compact).length,
            `${path}: visible compact section headings`
          ).toBe(compactSectionHeadings?.count ?? 0);
          for (const nestedHeading of nestedHeadings) {
            const expectedFamilies =
              nestedHeading.tag === 'H2' && !nestedHeading.compact
                ? ['Sora', 'Inter']
                : ['Inter', 'Segoe UI'];
            expect
              .soft(
                fontFamilies(nestedHeading.family).slice(0, 2),
                `${path}: ${nestedHeading.tag} ${nestedHeading.text}`
              )
              .toEqual(expectedFamilies);
          }
          expect
            .soft(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
              ),
              `${path}: horizontal overflow`
            )
            .toBe(true);

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
              .toBe(bodyFamily);
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
              .toBe(bodyFamily);
          }
          controlsChecked += controls.length;
        });
      }
      expect(buttonsChecked).toBeGreaterThan(0);
      expect(controlsChecked).toBeGreaterThan(0);
      expectLocalAdminFonts(fontRequests, page.url());
      expect(fixture.mutations).toEqual([]);
    });
  }
}
