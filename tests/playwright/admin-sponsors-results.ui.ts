import type { AdminSponsorshipRecord } from '@openg7/funding-core';
import type { Locator, Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';

interface SponsorResultsTestContext {
  readonly fixtures: (
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ) => Promise<{
    readonly calls: readonly { readonly method: string }[];
    readonly options: {
      listSize: number;
      listStatus: number;
      edited: Map<string, Partial<AdminSponsorshipRecord>>;
    };
  }>;
}

const firstId = '10000000-0000-4000-8000-000000000401';
const secondId = '10000000-0000-4000-8000-000000000402';
const longCompany =
  'Coopérative des bâtisseurs de la transition énergétique et des communautés du Saint-Laurent';
const longEmail =
  'responsable.commandites.et.partenariats@cooperative-des-batisseurs.example.invalid';

async function expectReadableWithinRow(
  row: Locator,
  text: Locator
): Promise<void> {
  await expect(text).toBeVisible();
  const rowBounds = await row.boundingBox();
  expect(rowBounds).not.toBeNull();
  expect(
    await text.evaluate((element, bounds) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].every(
        (rect) =>
          rect.left >= bounds!.x - 1 &&
          rect.right <= bounds!.x + bounds!.width + 1 &&
          rect.top >= bounds!.y - 1 &&
          rect.bottom <= bounds!.y + bounds!.height + 1
      );
    }, rowBounds)
  ).toBe(true);
}

export function registerSponsorResultsTests({
  fixtures
}: SponsorResultsTestContext): void {
  for (const locale of ['fr-CA', 'en'] as const) {
    for (const width of [1280, 390]) {
      const english = locale === 'en';
      test(`filled sponsor results keep long identities and independent states readable with keyboard navigation in ${locale} at ${width}px`, async ({
        page
      }, testInfo) => {
        const { calls, options } = await fixtures(page, 'reader');
        options.edited.set(firstId, {
          sponsor_company_name: longCompany,
          sponsor_contact_email: longEmail,
          sponsor_review_status: 'approved',
          public_display_consent: false,
          sponsor_feed_status: 'drafted',
          payment_status: 'paid'
        });
        options.edited.set(secondId, {
          sponsor_company_name: 'Atelier historique',
          sponsor_review_status: 'rejected',
          sponsor_feed_status: 'published',
          payment_status: 'refunded',
          sponsorship_refund_status: 'completed'
        });
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/admin/fundraiser/sponsors');
        if (english)
          await page
            .getByRole('button', {
              name: 'Switch administration language to English'
            })
            .click();
        const list = page.locator('[data-og7="sponsors-list"]');
        const summary = page.locator('[data-og7="sponsors-summary"]');
        await expect(summary).toHaveAccessibleName(
          english ? 'On this page' : 'Sur cette page'
        );
        await expect(summary.locator('dt')).toHaveText(
          english
            ? ['To review', 'Review approved and consent given', 'Active']
            : ['À réviser', 'Revue approuvée et consentement', 'Actives']
        );
        await expect(summary.locator('dd')).toHaveText(['0', '0', '1']);
        const first = list.locator(
          `[data-og7="sponsor-row"][data-og7-id="${firstId}"]`
        );
        const second = list.locator(
          `[data-og7="sponsor-row"][data-og7-id="${secondId}"]`
        );
        await expectReadableWithinRow(
          first,
          first.getByText(longCompany, { exact: true })
        );
        await expectReadableWithinRow(
          first,
          first.getByText(longEmail, { exact: true })
        );
        for (const label of english
          ? ['Approved', 'Draft', 'Paid']
          : ['Approuvee', 'Brouillon', 'Paye']) {
          await expect(first.getByText(label, { exact: true })).toBeVisible();
        }
        for (const label of english
          ? ['Refused', 'Published', 'Refunded']
          : ['Refusee', 'Publie', 'Rembourse']) {
          await expect(second.getByText(label, { exact: true })).toBeVisible();
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          []
        );
        await page.screenshot({
          path: testInfo.outputPath(`sponsors-filled-${locale}-${width}.png`),
          fullPage: true,
          animations: 'disabled'
        });

        await first.focus();
        await first.press('Enter');
        await expect(
          page.locator('[data-og7="sponsorship-dossier"]')
        ).toBeFocused();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          longCompany
        );
        await expect(summary).toBeHidden();
        if (width === 1280) {
          await expect(list).toBeHidden();
          await expect(
            list.getByRole('searchbox', { includeHidden: true })
          ).toHaveValue('');
        }
        const back = page.locator('[data-og7="dossier-back"]');
        await back.focus();
        await back.press('Enter');
        await expect(first).toBeFocused();
        await expect(list).toBeVisible();
        await expect(summary).toBeVisible();
        await expect(
          page.locator('[data-og7="sponsorship-dossier"]')
        ).toBeHidden();
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }

    for (const financial of [
      {
        scenario: 'a confirmed refund',
        payment: 'refunded',
        refund: 'completed',
        labels: {
          'fr-CA': ['Rembourse', 'Remboursement terminé'],
          en: ['Refunded', 'Refund complete']
        }
      },
      {
        scenario: 'a payment dispute',
        payment: 'disputed',
        refund: 'not_requested',
        labels: { 'fr-CA': ['Litige'], en: ['Disputed'] }
      },
      {
        scenario: 'a refund in progress',
        payment: 'paid',
        refund: 'processing',
        labels: {
          'fr-CA': ['Paye', 'Remboursement en cours'],
          en: ['Paid', 'Refund in progress']
        }
      }
    ] as const) {
      test(`compact sponsor queue keeps ${financial.scenario} distinct from an approved review in ${locale} at 1440px`, async ({
        page
      }) => {
        const { calls, options } = await fixtures(page, 'reader');
        options.edited.set(firstId, {
          sponsor_review_status: 'approved',
          payment_status: financial.payment,
          sponsorship_refund_status: financial.refund
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(
          `/admin/fundraiser/sponsors?sponsorshipId=${firstId}&tab=overview`
        );
        const dossier = page.locator('[data-og7="sponsorship-dossier"]');
        await expect(dossier).toBeVisible();
        if (locale === 'en')
          await page
            .getByRole('button', {
              name: 'Switch administration language to English'
            })
            .click();
        const list = page.locator('[data-og7="sponsors-list"]');
        const search = list.getByRole('searchbox');
        await expect(search).toHaveValue(firstId);
        await search.fill('');
        await expect(list.locator('[data-og7="sponsor-row"]')).toHaveCount(2);
        await expect(dossier).toBeVisible();
        const row = list.locator(
          `[data-og7="sponsor-row"][data-og7-id="${firstId}"]`
        );
        await expect(row).toHaveAttribute('aria-current', 'true');
        await expectReadableWithinRow(
          row,
          row.getByText(locale === 'en' ? 'Approved' : 'Approuvee', {
            exact: true
          })
        );
        for (const label of financial.labels[locale]) {
          await expectReadableWithinRow(
            row,
            row.getByText(label, { exact: true })
          );
        }
        expect(
          await row.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1
          )
        ).toBe(true);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }
  }

  test('English mobile sponsor results recover from a failed load with a keyboard retry', async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'reader');
    options.listStatus = 503;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/fundraiser/sponsors');
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
    const list = page.locator('[data-og7="sponsors-list"]');
    const retry = list.getByRole('button', { name: 'Try again', exact: true });
    await expect(retry).toBeVisible();
    await expect(list.locator('[data-og7="sponsor-row"]')).toHaveCount(0);
    options.listStatus = 200;
    await retry.focus();
    await retry.press('Enter');
    await expect(list.locator('[data-og7="sponsor-row"]')).toHaveCount(2);
    await expect(retry).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

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
          ? 'No sponsorships yet'
          : 'Aucune commandite pour le moment',
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
