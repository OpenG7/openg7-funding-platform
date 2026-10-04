import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';

interface SponsorResultsTestContext {
  readonly fixtures: (
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ) => Promise<{
    readonly calls: readonly { readonly method: string }[];
    readonly options: { listSize: number };
  }>;
}

export function registerSponsorResultsTests({
  fixtures
}: SponsorResultsTestContext): void {
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    const english = locale === 'en';

    test(`sponsor results distinguish an empty queue from empty filters and reset with the keyboard in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'reader');
      options.listSize = 0;
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/admin/fundraiser/sponsors');
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const list = page.locator('[data-og7="sponsors-list"]');
      const emptyQueue = list.getByRole('heading', {
        name: english
          ? 'All sponsorships have been reviewed.'
          : 'Toutes les commandites ont ete revisees.',
        exact: true
      });
      const emptyFilters = list.getByRole('heading', {
        name: english
          ? 'No sponsorship matches the filters.'
          : 'Aucune commandite ne correspond aux filtres.',
        exact: true
      });
      const reset = list.getByRole('button', {
        name: english ? 'Reset filters' : 'Reinitialiser les filtres',
        exact: true
      });
      await expect(emptyQueue).toBeVisible();
      await expect(emptyFilters).toHaveCount(0);
      await expect(reset).toHaveCount(0);
      await expect(list.locator('[data-og7="sponsor-row"]')).toHaveCount(0);
      await expect(
        list.getByRole('button', {
          name: english ? 'Next page' : 'Page suivante',
          exact: true
        })
      ).toHaveCount(0);

      await list.getByRole('searchbox').fill('Synthetic no match');
      await expect(emptyFilters).toBeVisible();
      await expect(emptyQueue).toHaveCount(0);
      await expect(reset).toBeEnabled();
      await reset.focus();
      await reset.press('Enter');
      await expect(list.getByRole('searchbox')).toHaveValue('');
      await expect(emptyQueue).toBeVisible();
      await expect(emptyFilters).toHaveCount(0);
      await expect(reset).toHaveCount(0);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }
}
