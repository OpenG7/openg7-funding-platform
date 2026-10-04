import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';

interface SponsorFiltersTestContext {
  readonly fixtures: (
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ) => Promise<{
    readonly calls: readonly {
      readonly url: URL;
      readonly method: string;
    }[];
  }>;
  readonly path: (tab?: string, value?: string) => string;
}

export function registerSponsorFiltersTests({
  fixtures,
  path
}: SponsorFiltersTestContext): void {
  for (const { locale, width, compact } of [
    { locale: 'fr-CA', width: 1440, compact: true },
    { locale: 'en', width: 390, compact: false }
  ]) {
    test(`sponsor publication and payment filters preserve their bindings and reset in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls } = await fixtures(page, 'reader');
      const english = locale === 'en';
      const waitForListResponse = (
        matches: (query: URLSearchParams) => boolean
      ) =>
        page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            response.request().method() === 'GET' &&
            url.pathname === '/api/admin/sponsorships' &&
            matches(url.searchParams)
          );
        });
      await page.setViewportSize({ width, height: 900 });
      const route = compact ? path() : '/admin/fundraiser/sponsors';
      const initialLoad = waitForListResponse(() => true);
      await page.goto(route);
      await (await initialLoad).finished();
      const list = page.locator('[data-og7="sponsors-list"]');
      const search = list.getByRole('searchbox');
      const firstRow = list.locator('[data-og7="sponsor-row"]').first();
      await expect(firstRow).toBeVisible();
      await expect(search).toHaveValue(
        compact
          ? (new URL(route, 'https://fixture.example.invalid').searchParams.get(
              'sponsorshipId'
            ) ?? '')
          : ''
      );
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();

      const summary = list.locator('summary');
      await expect(summary).toContainText(english ? 'Filters' : 'Filtres');
      await summary.focus();
      await expect(summary).toBeFocused();
      await summary.press('Enter');
      await expect(list.locator('details')).toHaveAttribute('open', '');
      const review = list.getByRole('combobox', {
        name: english ? 'Review status' : 'Statut de revue',
        exact: true
      });
      const feed = list.getByRole('combobox', {
        name: english
          ? 'Visibility / publication status'
          : 'Visibilite / statut feed',
        exact: true
      });
      const payment = list.getByRole('combobox', {
        name: english ? 'Payment' : 'Paiement',
        exact: true
      });
      const reset = list.getByRole('button', {
        name: english ? 'Reset' : 'Reinitialiser',
        exact: true
      });
      if (compact) await expect(reset).toBeEnabled();
      else await expect(reset).toBeDisabled();
      const feedLoad = waitForListResponse(
        (query) => query.get('feedStatus') === 'drafted'
      );
      await feed.selectOption('drafted');
      await (await feedLoad).finished();
      await expect(firstRow).toBeVisible();
      await expect
        .poll(() =>
          calls
            .filter(({ url }) => url.pathname === '/api/admin/sponsorships')
            .at(-1)
            ?.url.searchParams.get('feedStatus')
        )
        .toBe('drafted');
      const paymentLoad = waitForListResponse(
        (query) =>
          query.get('feedStatus') === 'drafted' &&
          query.get('paymentStatus') === 'refunded'
      );
      await payment.selectOption('refunded');
      await (await paymentLoad).finished();
      await expect(firstRow).toBeVisible();
      await expect
        .poll(() =>
          calls
            .filter(({ url }) => url.pathname === '/api/admin/sponsorships')
            .at(-1)
            ?.url.searchParams.get('paymentStatus')
        )
        .toBe('refunded');
      await expect(feed).toHaveValue('drafted');
      await expect(payment).toHaveValue('refunded');
      await expect(reset).toBeEnabled();
      const resetLoad = waitForListResponse((query) =>
        ['search', 'reviewStatus', 'feedStatus', 'paymentStatus'].every(
          (key) => !query.has(key)
        )
      );
      await reset.focus();
      await expect(reset).toBeFocused();
      await reset.press('Enter');
      await (await resetLoad).finished();
      await expect(firstRow).toBeVisible();
      await expect(search).toHaveValue('');
      await expect(review).toHaveValue('all');
      await expect(feed).toHaveValue('all');
      await expect(payment).toHaveValue('all');
      await expect(reset).toBeDisabled();
      await expect
        .poll(() => {
          const query = calls
            .filter(({ url }) => url.pathname === '/api/admin/sponsorships')
            .at(-1)?.url.searchParams;
          return query
            ? ['search', 'reviewStatus', 'feedStatus', 'paymentStatus'].filter(
                (key) => query.has(key)
              )
            : undefined;
        })
        .toEqual([]);
      expect(calls.every(({ method }) => method === 'GET')).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
}
