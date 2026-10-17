import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';
import type {
  AdminContributionRecord,
  AdminContributionsExportRequest,
  AdminContributionsResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  blockAdminReviewWrites,
  captureAdminDesign,
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';

const date = '2026-09-23T12:00:00Z';
const personal: AdminContributionRecord = {
  id: '10000000-0000-4000-8000-000000000741',
  public_reference: 'OG7-SYNTHETIC-PERSONAL',
  contribution_type: 'personal_support',
  amount: 25,
  currency: 'CAD',
  payment_status: 'paid',
  paid_at: date,
  public_name: 'Personne synthétique',
  email_private: 'personal@example.test',
  public_display_consent: false,
  display_amount_consent: false,
  non_charity_acknowledged: true,
  sponsor_company_name: null,
  sponsor_contact_name: null,
  sponsor_contact_email: null,
  sponsor_review_status: null,
  sponsor_feed_status: null,
  stripe_session_id: 'cs_test_contribution_personal',
  stripe_payment_intent_id: 'pi_test_contribution_personal',
  created_at: date,
  updated_at: date
};
const sponsor: AdminContributionRecord = {
  ...personal,
  id: '10000000-0000-4000-8000-000000000742',
  public_reference: 'OG7-SYNTHETIC-SPONSOR',
  contribution_type: 'sponsorship_interest',
  amount: 500,
  public_name: null,
  email_private: null,
  public_display_consent: true,
  display_amount_consent: true,
  sponsor_company_name: 'Entreprise synthétique',
  sponsor_contact_name: 'Contact synthétique',
  sponsor_contact_email: 'sponsor@example.test',
  sponsor_review_status: 'approved',
  sponsor_feed_status: 'not_planned',
  stripe_session_id: 'cs_test_contribution_sponsor',
  stripe_payment_intent_id: 'pi_test_contribution_sponsor',
  updated_at: '2026-09-24T12:00:00Z'
};
const listing: AdminContributionsResponse = {
  data_source: 'database',
  contributions: [personal, sponsor],
  last_updated_at: date,
  summary: {
    total_count: 2,
    paid_count: 2,
    pending_count: 0,
    sponsorship_count: 1,
    public_display_count: 1,
    total_received: 525,
    total_refunded: 0,
    total_disputed: 0,
    currency: 'CAD'
  }
};
const csv = 'reference,email\nOG7-SYNTHETIC-SPONSOR,sponsor@example.test\n';

function seedSession(language: string): void {
  localStorage.setItem('openg7.language', language);
  sessionStorage.setItem(
    'openg7-admin-session-token',
    'openg7-admin-session.contributions-fixture'
  );
  sessionStorage.setItem(
    'openg7-admin-session-expires-at',
    '2099-01-01T00:00:00Z'
  );
}

async function fixtures(page: Page, language: string) {
  await page.addInitScript(seedSession, language);
  const options = {
    status: 200,
    listStatus: 200,
    listing,
    gate: null as Promise<void> | null,
    listLoads: 0
  };
  const exports: AdminContributionsExportRequest[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/contributions.csv')) {
      expect(route.request().method()).toBe('POST');
      exports.push(route.request().postDataJSON());
      if (options.gate) await options.gate;
      return route.fulfill(
        options.status === 200
          ? { contentType: 'text/csv', body: csv }
          : { status: options.status, json: {} }
      );
    }
    if (path.endsWith('/contributions')) {
      options.listLoads++;
      return route.fulfill({
        status: options.listStatus,
        json: options.listStatus === 200 ? options.listing : {}
      });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return { options, exports };
}

const contributionPalettes = {
  mineral: {
    panel: 'rgb(255, 255, 255)',
    raised: 'rgb(240, 244, 249)',
    selected: 'rgb(237, 243, 250)',
    text: 'rgb(23, 43, 80)',
    muted: 'rgb(82, 98, 123)',
    border: 'rgb(216, 224, 236)',
    focus: 'rgb(53, 106, 159)'
  },
  night: {
    panel: 'rgb(20, 35, 56)',
    raised: 'rgb(27, 45, 68)',
    selected: 'rgb(36, 61, 83)',
    text: 'rgb(241, 245, 252)',
    muted: 'rgb(189, 203, 224)',
    border: 'rgb(64, 86, 111)',
    focus: 'rgb(158, 218, 255)'
  },
  graphite: {
    panel: 'rgb(37, 41, 47)',
    raised: 'rgb(50, 56, 65)',
    selected: 'rgb(56, 67, 79)',
    text: 'rgb(243, 244, 246)',
    muted: 'rgb(196, 203, 213)',
    border: 'rgb(86, 97, 110)',
    focus: 'rgb(194, 227, 255)'
  }
} as const;

function contributionRegions(page: Page, english: boolean) {
  return {
    summary: page.getByRole('region', {
      name: english ? 'Contribution summary' : 'Resume contributions',
      exact: true
    }),
    filters: page.getByRole('region', {
      name: english ? 'Contribution filters' : 'Filtres contributions',
      exact: true
    }),
    list: page.locator('[data-og7="contributions-list"]')
  };
}

for (const language of ['fr-CA', 'en'] as const)
  for (const width of [390, 1536]) {
    test(`contribution composition keeps the summary and register accessible in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await prepareAdminDesignReview(page);
      await fixtures(page, language);
      const writes = await blockAdminReviewWrites(page);
      await page.setViewportSize({
        width,
        height: width === 1536 ? 864 : 1000
      });
      await page.goto('/admin/fundraiser/contributions');
      const { summary, filters, list } = contributionRegions(
        page,
        language === 'en'
      );
      await expect(summary.getByRole('article')).toHaveCount(4);
      await expect(list.locator('[data-og7="contribution-row"]')).toHaveCount(
        2
      );
      await expect(summary).toContainText('525');
      await expect(summary).toContainText('CAD');
      await captureAdminDesign(page, testInfo, `contributions-${width}`);
      if (width === 1536) {
        for (const metric of await summary.getByRole('article').all())
          await expect(metric).toBeInViewport({ ratio: 1 });
        await expect(filters).toBeInViewport({ ratio: 1 });
        await expect(list.getByRole('heading', { level: 2 })).toBeInViewport({
          ratio: 1
        });
      }
      const row = list.locator('[data-og7="contribution-row"]').first();
      await row.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.locator('[data-og7="contribution-detail"]')
      ).toContainText(personal.public_reference!);
      await expect(row).toBeFocused();
      if (width === 1536)
        await captureAdminDesign(
          page,
          testInfo,
          'contributions-detail-1536',
          true
        );
      if (language === 'en') {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await expectAdminPageFits(page);
        const search = filters.getByRole('searchbox');
        await search.fill('no synthetic match');
        await expect(list.getByRole('article')).toBeVisible();
        await search.clear();
        await expect(list.locator('[data-og7="contribution-row"]')).toHaveCount(
          2
        );
      }
      expect(writes).toEqual([]);
    });
  }

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  for (const { language, width } of [
    { language: 'fr-CA', width: 390 },
    { language: 'en', width: 1440 }
  ] as const) {
    test(`contribution CSS preserves ${theme} surfaces, local table scrolling and keyboard selection in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      const palette = contributionPalettes[theme];
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript((theme) => {
        localStorage.setItem(
          'openg7.pilotage.appearance.v1',
          JSON.stringify({ theme, system: false, density: 'comfortable' })
        );
      }, theme);
      const { exports } = await fixtures(page, language);
      await page.goto('/admin/fundraiser/contributions');
      const { summary, filters, list } = contributionRegions(page, english);
      await expect(summary.getByRole('article')).toHaveCount(4);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        theme
      );
      for (const panel of [
        summary.getByRole('article').first(),
        filters,
        list
      ]) {
        await expect(panel).toHaveCSS('background-color', palette.panel);
      }
      const search = filters.getByRole('searchbox');
      await expect(search).toHaveCSS('background-color', palette.panel);
      await expect(search).toHaveCSS('color', palette.text);
      expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      const table = list.getByRole('table');
      await expect(table).toHaveCSS('min-width', '1184px');
      await expect(table).toHaveCSS('border-collapse', 'collapse');
      await expect(table.getByRole('columnheader').first()).toHaveCSS(
        'color',
        palette.muted
      );
      const scrolling = table.locator('..');
      await expect(scrolling).toHaveCSS('overflow-x', 'auto');
      expect(
        await scrolling.evaluate((node) => node.scrollWidth > node.clientWidth)
      ).toBe(true);
      await scrolling.evaluate((node) => {
        node.scrollLeft = node.scrollWidth;
      });
      await expect
        .poll(() => scrolling.evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);

      const sponsorRow = page.locator(
        `[data-og7="contribution-row"][data-og7-id="${sponsor.id}"]`
      );
      await sponsorRow.focus();
      await page.keyboard.press('Space');
      const detail = page.locator('[data-og7="contribution-detail"]');
      await expect(detail).toContainText(sponsor.sponsor_company_name!);
      await expect(detail).toHaveCSS('background-color', palette.panel);
      await expect(sponsorRow).toBeFocused();
      await expect(sponsorRow).toHaveCSS('background-color', palette.selected);
      await expect(sponsorRow).toHaveCSS('outline-width', '3px');
      await expect(sponsorRow).toHaveCSS('outline-color', palette.focus);
      const personalRow = page.locator(
        `[data-og7="contribution-row"][data-og7-id="${personal.id}"]`
      );
      await personalRow.focus();
      await page.keyboard.press('Enter');
      await expect(detail).toContainText(personal.public_name!);
      await expect(personalRow).toBeFocused();

      await search.fill('No matching synthetic contribution');
      const empty = list.getByRole('article');
      await expect(empty).toBeVisible();
      await expect(empty).toHaveCSS('background-color', palette.raised);
      await expect(empty).toHaveCSS('border-top-style', 'dashed');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(exports).toEqual([]);
    });
  }
}

test('contribution metrics, filters and local register fit resized viewports without losing filter input', async ({
  page
}) => {
  await fixtures(page, 'fr-CA');
  await page.goto('/admin/fundraiser/contributions');
  const { summary, filters, list } = contributionRegions(page, false);
  await expect(summary.getByRole('article')).toHaveCount(4);
  const search = filters.getByRole('searchbox');
  await search.fill('Entreprise');
  for (const width of [390, 851, 860, 861, 1020, 1021, 1536]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 950 });
      await expect(summary.getByRole('article')).toHaveCount(4);
      await expect(search).toHaveValue('Entreprise');
      await expect(list.locator('[data-og7="contribution-row"]')).toHaveCount(
        1
      );
      for (const control of await filters.locator('input, select').all()) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(-1);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      await expectAdminPageFits(page);
      await expect(list.getByRole('table')).toHaveCSS('min-width', '1184px');
    });
  }
});

// These fixtures exercise rendered Angular UI with synthetic intercepted API
// responses. Docker accounting and signed OIDC identity tests stay separate.
for (const source of ['contributions', 'export', 'activity']) {
  test(`session refusal from ${source} purges private contributions and redirects to login`, async ({
    page
  }) => {
    const { options } = await fixtures(page, 'fr-CA');
    let activityUnauthorized = false;
    await page.route('**/api/admin/contribution-activity**', (route) =>
      route.fulfill({ status: activityUnauthorized ? 401 : 503, json: {} })
    );
    await page.goto('/admin/fundraiser/contributions');
    const row = page.locator(
      `[data-og7="contribution-row"][data-og7-id="${personal.id}"]`
    );
    await row.click();
    await expect(page.getByRole('main')).toContainText(personal.email_private!);
    if (source === 'contributions') {
      options.listStatus = 401;
      await page
        .getByRole('button', { name: 'Actualiser', exact: true })
        .click();
    } else if (source === 'export') {
      options.status = 401;
      await page.locator('[data-og7="contribution-export"]').click();
      await page.locator('[data-og7="confirm-action"]').click();
    } else activityUnauthorized = true;
    await expect(page).toHaveURL(/\/admin\/login\?.*sessionExpired=1/, {
      timeout: 15000
    });
    await expect(page.getByRole('main')).not.toContainText(
      personal.email_private!
    );
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('openg7-admin-session-token')
      )
    ).toBeNull();
  });
}

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1280]) {
    const english = language === 'en';
    const searchLabel = english ? 'Search' : 'Recherche';
    const refreshLabel = english ? 'Refresh' : 'Actualiser';

    test(`contribution surfaces preserve filters, keyboard selection and confirmed export in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 950 });
      const { options, exports } = await fixtures(page, language);
      await page.goto('/admin/fundraiser/contributions');
      const rows = page.locator('[data-og7="contribution-row"]');
      const exportButton = page.locator('[data-og7="contribution-export"]');
      const search = page.getByLabel(searchLabel, { exact: true });
      const scope = page.locator('[data-og7="contribution-export-scope"]');
      await expect(rows).toHaveCount(2);
      await expect(
        page.getByRole('region', {
          name: english ? 'Contribution summary' : 'Resume contributions',
          exact: true
        })
      ).toContainText('525');
      await expect(scope).toContainText('2');

      const sponsorRow = page.locator(
        `[data-og7="contribution-row"][data-og7-id="${sponsor.id}"]`
      );
      await sponsorRow.focus();
      await page.keyboard.press('Space');
      const detail = page.getByRole('region', {
        name: english ? 'Contribution details' : 'Détail de la contribution',
        exact: true
      });
      await expect(detail).toContainText('Entreprise synthétique');
      await expect(page).toHaveURL(new RegExp(`contributionId=${sponsor.id}`));
      await expect(sponsorRow).toBeFocused();

      await search.fill('cs_test_contribution_sponsor');
      await expect(rows).toHaveCount(1);
      const filters = page.getByRole('region', {
        name: english ? 'Contribution filters' : 'Filtres contributions',
        exact: true
      });
      const type = filters.getByRole('combobox', { name: 'Type', exact: true });
      await type.selectOption('personal_support');
      await expect(rows).toHaveCount(0);
      await expect(exportButton).toBeDisabled();
      await type.selectOption('sponsorship_interest');
      await expect(rows).toHaveCount(1);
      const status = filters.getByRole('combobox', {
        name: english ? 'Payment status' : 'Statut paiement',
        exact: true
      });
      await status.selectOption('pending');
      await expect(rows).toHaveCount(0);
      await status.selectOption('paid');
      const consent = filters.getByRole('combobox', {
        name: english ? 'Public display' : 'Affichage public',
        exact: true
      });
      await consent.selectOption('private');
      await expect(rows).toHaveCount(0);
      await consent.selectOption('public');
      await expect(rows).toHaveCount(1);
      await expect(scope).toContainText(
        english
          ? 'the contribution displayed after filtering'
          : 'la contribution affichée après filtrage'
      );

      await exportButton.click();
      await expect(page.getByRole('dialog')).toContainText(
        english ? 'private data' : 'données privées'
      );
      // The opener stays enabled so the shared modal can restore focus, while
      // the page's synchronous phase guard rejects another export submission.
      await exportButton.dispatchEvent('click');
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(exportButton).toBeFocused();
      expect(exports).toHaveLength(0);

      await exportButton.click();
      const downloaded = page.waitForEvent('download');
      await page.locator('[data-og7="confirm-action"]').click();
      const download = await downloaded;
      expect(download.suggestedFilename()).toBe(
        'openg7-admin-contributions.csv'
      );
      expect(await readFile((await download.path())!, 'utf8')).toBe(csv);
      expect(exports).toEqual([
        {
          confirmation: 'export_private_contributions',
          contributions: [
            { id: sponsor.id, expectedVersion: sponsor.updated_at }
          ]
        }
      ]);

      await search.fill('');
      await type.selectOption('all');
      await status.selectOption('all');
      await consent.selectOption('all');
      const personalRow = page.locator(
        `[data-og7="contribution-row"][data-og7-id="${personal.id}"]`
      );
      await personalRow.focus();
      await page.keyboard.press('Enter');
      await expect(detail).toContainText('Personne synthétique');
      const updated = { ...personal, public_name: 'Personne actualisée' };
      options.listing = { ...listing, contributions: [updated, sponsor] };
      await page
        .getByRole('button', { name: refreshLabel, exact: true })
        .click();
      await expect(detail).toContainText('Personne actualisée');
      expect(options.listLoads).toBe(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await expect(page.getByRole('main')).not.toContainText('admin.legacy.');
    });

    test(`private export preserves 401, 403, 409 and failure messages in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 950 });
      const { options, exports } = await fixtures(page, language);
      await page.goto('/admin/fundraiser/contributions');
      const exportButton = page.locator('[data-og7="contribution-export"]');
      await expect(exportButton).toBeEnabled();
      const downloads: string[] = [];
      page.on('download', (download) =>
        downloads.push(download.suggestedFilename())
      );
      const messages = english
        ? {
            409: 'The selection has changed.',
            403: 'Private exports are restricted to owners.',
            503: 'The export could not be generated.',
            401: 'Your session has expired.'
          }
        : {
            409: 'La sélection a changé.',
            403: 'L’export privé est réservé aux propriétaires.',
            503: 'L’export n’a pas pu être généré.',
            401: 'Votre session a expiré.'
          };
      for (const status of [409, 403, 503] as const) {
        options.status = status;
        await exportButton.click();
        await page.locator('[data-og7="confirm-action"]').click();
        await expect(
          page.locator('[data-og7="contribution-export-error"]')
        ).toContainText(messages[status]);
        await expect(exportButton).toBeEnabled();
      }
      expect(exports).toHaveLength(3);
      for (const payload of exports)
        expect(payload.contributions).toEqual([
          { id: personal.id, expectedVersion: personal.updated_at },
          { id: sponsor.id, expectedVersion: sponsor.updated_at }
        ]);
      expect(downloads).toEqual([]);

      options.listStatus = 503;
      await page
        .getByRole('button', { name: refreshLabel, exact: true })
        .click();
      await expect(exportButton).toBeDisabled();
      await expect(
        page.getByText(
          english
            ? /Could not load or export contributions/
            : /Impossible de charger ou exporter les contributions/
        )
      ).toBeVisible();
      options.listStatus = 200;
      await page
        .getByRole('button', { name: refreshLabel, exact: true })
        .click();
      await expect(exportButton).toBeEnabled();
      await expect(
        page.locator('[data-og7="contribution-export-error"]')
      ).toHaveCount(0);
    });

    test(`private export abandons changed confirmation scope and late results in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 950 });
      const { options, exports } = await fixtures(page, language);
      await page.goto('/admin/fundraiser/contributions');
      const exportButton = page.locator('[data-og7="contribution-export"]');
      const search = page.getByLabel(searchLabel, { exact: true });
      const dialog = page.getByRole('dialog');
      const rows = page.locator('[data-og7="contribution-row"]');
      await expect(exportButton).toBeEnabled();
      const downloads: string[] = [];
      page.on('download', (download) =>
        downloads.push(download.suggestedFilename())
      );

      await exportButton.click();
      await expect(dialog).toContainText('2');
      // A scope update may arrive while the modal prevents direct pointer input.
      // Even restoring the original filters must require a fresh decision.
      for (const value of ['Entreprise', '']) {
        await search.evaluate((input: HTMLInputElement, value) => {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
      }
      await page.locator('[data-og7="confirm-action"]').click();
      // An enabled export button does not mean the native modal is closed.
      await expect(dialog).toHaveCount(0);
      await expect(exportButton).toBeEnabled();
      expect(exports).toHaveLength(0);

      for (const status of [200, 403] as const) {
        await search.fill('Entreprise');
        await expect(rows).toHaveCount(1);
        await expect(rows).toHaveAttribute('data-og7-id', sponsor.id);
        options.status = status;
        let release!: () => void;
        options.gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await exportButton.click();
        await page.locator('[data-og7="confirm-action"]').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => exports.length).toBe(status === 200 ? 1 : 2);
        await expect(exportButton).toBeDisabled();
        await search.fill('Personne');
        await expect(search).toHaveValue('Personne');
        await expect(rows).toHaveAttribute('data-og7-id', personal.id);
        await search.fill('Entreprise');
        await expect(search).toHaveValue('Entreprise');
        await expect(rows).toHaveAttribute('data-og7-id', sponsor.id);
        const completed = page.waitForResponse((response) =>
          new URL(response.url()).pathname.endsWith('/contributions.csv')
        );
        release();
        await (await completed).finished();
        await expect(exportButton).toBeEnabled();
        await expect(
          page.locator('[data-og7="contribution-export-error"]')
        ).toHaveCount(0);
        expect(downloads).toEqual([]);
      }
      for (const payload of exports)
        expect(payload.contributions).toEqual([
          { id: sponsor.id, expectedVersion: sponsor.updated_at }
        ]);
      options.gate = null;

      await exportButton.click();
      const refresh = page.getByRole('button', {
        name: refreshLabel,
        exact: true
      });
      await refresh.dispatchEvent('click');
      await expect.poll(() => options.listLoads).toBe(2);
      await page.locator('[data-og7="confirm-action"]').click();
      await expect(dialog).toHaveCount(0);
      await expect(exportButton).toBeEnabled();
      expect(exports).toHaveLength(2);
    });

    test(`private export remains restricted to owners in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript((language) => {
        localStorage.setItem('openg7.language', language);
      }, language);
      let role = 'reader';
      let exports = 0;
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/auth/current'))
          return route.fulfill({
            json: {
              id: 'synthetic-account',
              sessionId: 'synthetic-session',
              displayName: 'Compte synthétique',
              role,
              expiresAt: '2099-01-01T00:00:00Z'
            }
          });
        if (path.endsWith('/contributions'))
          return route.fulfill({ json: listing });
        if (path.endsWith('/contributions.csv')) {
          exports++;
          return route.fulfill({ contentType: 'text/csv', body: csv });
        }
        return route.fulfill({ status: 503, json: {} });
      });
      const exportButton = page.locator('[data-og7="contribution-export"]');
      for (const nextRole of ['reader', 'operator']) {
        role = nextRole;
        await page.goto('/admin/fundraiser/contributions');
        await expect(page.locator('[data-og7="contribution-row"]')).toHaveCount(
          2
        );
        await expect(exportButton).toBeDisabled();
        await expect(
          page.getByText(
            english
              ? 'Private exports are restricted to owners.'
              : 'L’export privé est réservé aux propriétaires.',
            { exact: true }
          )
        ).toBeVisible();
        await exportButton.dispatchEvent('click');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
      expect(exports).toBe(0);
    });
  }
}
