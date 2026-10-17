import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipProgressResponse,
  AdminSponsorshipRecord
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface SponsorFinanceTestContext {
  readonly fixtures: (
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ) => Promise<{
    readonly calls: readonly { readonly method: string; readonly url: URL }[];
    readonly options: {
      status: number;
      state: AdminSponsorshipProgressResponse['status'];
      progressGate: Promise<void> | null;
      progressOverrides: Partial<AdminSponsorshipProgress>;
      readonly edited: Map<string, Partial<AdminSponsorshipRecord>>;
    };
  }>;
  readonly path: (tab?: string, value?: string) => string;
}

const id = '10000000-0000-4000-8000-000000000401';
const progress = (page: Page) =>
  page.locator('[data-og7="sponsorship-progress"]');
const finance = (page: Page) => page.locator('[data-og7="dossier-finances"]');

async function useEnglish(page: Page): Promise<void> {
  await page
    .getByRole('button', {
      name: 'Switch administration language to English'
    })
    .click();
}

async function expectResponsiveFinance(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-og7="sponsorship-dossier"]')
        .analyze()
    ).violations
  ).toEqual([]);
}

/** Financial projections are synthetic; these journeys never call Stripe. */
export function registerSponsorFinanceTests({
  fixtures,
  path
}: SponsorFinanceTestContext): void {
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    const english = locale === 'en';

    test(`finance zone retries a failed projection by keyboard without losing recorded history in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { options, calls } = await fixtures(page, 'reader');
      options.status = 500;
      options.edited.set(id, {
        sponsorship_refund_status: 'completed',
        sponsorship_refund_requested_at: '2026-09-14T14:00:00Z',
        sponsorship_refund_completed_at: '2026-09-16T14:00:00Z',
        sponsorship_refund_note: 'Synthetic recorded refund note'
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('billing'));
      if (english) await useEnglish(page);

      const history = finance(page).locator(
        '[data-og7="dossier-refund-history"]'
      );
      await expect(progress(page).getByRole('alert')).toHaveCount(1);
      await expect(progress(page).getByRole('alert')).toContainText(
        english ? 'Progress is unavailable' : 'La progression est indisponible'
      );
      await expect(history).toContainText('Synthetic recorded refund note');
      await expect(
        history.locator('[data-og7="dossier-refund-timeline"] li')
      ).toHaveCount(2);
      await expect(
        finance(page).locator('[data-og7="dossier-facts"]')
      ).toHaveCount(0);
      await expect(
        page.getByText(
          english
            ? 'Dossier facts are not available yet. Check the loading status above.'
            : 'Les faits du dossier ne sont pas encore disponibles. Consultez l’état de chargement ci-dessus.',
          { exact: true }
        )
      ).toHaveCount(0);
      await expectResponsiveFinance(page);

      const requestsBefore = calls.filter((call) =>
        call.url.pathname.endsWith('/sponsorships/progress')
      ).length;
      let release!: () => void;
      options.status = 200;
      options.progressGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        const retry = progress(page).getByRole('button', {
          name: english ? 'Try again' : 'Réessayer',
          exact: true
        });
        await retry.focus();
        await expect(retry).toBeFocused();
        await retry.press('Enter');
        await expect(progress(page)).toHaveAttribute('aria-busy', 'true');
        await expect(progress(page).getByRole('status')).toHaveText(
          english ? 'Loading dossier…' : 'Chargement du dossier…'
        );
        await expect(progress(page).getByRole('alert')).toHaveCount(0);
        await expect(
          finance(page).locator('[data-og7="dossier-facts"]')
        ).toHaveCount(0);
        await expect(history).toContainText('Synthetic recorded refund note');
        await expect
          .poll(
            () =>
              calls.filter((call) =>
                call.url.pathname.endsWith('/sponsorships/progress')
              ).length
          )
          .toBe(requestsBefore + 1);
      } finally {
        options.progressGate = null;
        release();
      }

      await expect(progress(page)).toHaveAttribute('aria-busy', 'false');
      await expect(finance(page).locator('#dossier-billing')).toContainText(
        'FAC-DEMO-401'
      );
      await expect(
        finance(page).locator('#dossier-billing time')
      ).toHaveAttribute('datetime', '2026-09-16T14:00:00Z');
      await expect(finance(page).locator('#dossier-billing')).toContainText(
        'CAD'
      );
      await expect(finance(page).locator('#dossier-refund')).toContainText(
        english ? '200.00' : '200,00'
      );
      await expect(finance(page).locator('#dossier-refund')).toBeFocused();
      await expect(progress(page).getByRole('button')).toHaveCount(0);
      await expect(history).toContainText('Synthetic recorded refund note');
      await expectResponsiveFinance(page);
      await finance(page).screenshot({
        path: `test-results/admin-finance-recovered-${locale}-${width}.png`
      });
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`finance zone distinguishes an empty document register and a confirmed zero refund in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { options, calls } = await fixtures(page, 'reader');
      options.progressOverrides = {
        documents: [],
        failedEmails: [],
        refund: {
          workflow: 'not_requested',
          state: 'not_required',
          confirmedAmountMinor: 0,
          creditMissing: false,
          hasError: false
        }
      };
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('billing'));
      if (english) await useEnglish(page);

      const documents = finance(page).locator('#dossier-billing');
      const refund = finance(page).locator('#dossier-refund');
      const history = finance(page).locator(
        '[data-og7="dossier-refund-history"]'
      );
      await expect(documents).toContainText(
        english ? 'No documents issued.' : 'Aucun document émis.'
      );
      await expect(
        documents.getByRole('link', {
          name: english
            ? 'Open dossier billing'
            : 'Ouvrir la facturation du dossier'
        })
      ).toHaveAttribute('href', new RegExp(`contributionId=${id}`));
      await expect(refund).toContainText(
        english ? 'Confirmed total refunded' : 'Total confirmé remboursé'
      );
      await expect(refund).toContainText(english ? '0.00' : '0,00');
      await expect(history).toContainText(
        english
          ? 'No refund has been requested for this sponsorship.'
          : /Aucun remboursement n['’]est demand/
      );
      await expect(history).not.toContainText('Stripe');
      await expect(
        history.locator('[data-og7="dossier-refund-timeline"]')
      ).toHaveCount(0);
      await expectResponsiveFinance(page);
      await finance(page).screenshot({
        path: `test-results/admin-finance-empty-${locale}-${width}.png`
      });
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`finance zone keeps a partial confirmed refund distinct from a missing credit note in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { options, calls } = await fixtures(page, 'reader');
      options.progressOverrides = {
        refund: {
          workflow: 'completed',
          state: 'partial',
          confirmedAmountMinor: 12345,
          creditMissing: true,
          hasError: false
        }
      };
      options.edited.set(id, {
        sponsorship_refund_status: 'completed',
        sponsorship_refund_amount: 123.45,
        sponsorship_refund_id: 're_synthetic_partial',
        sponsorship_refund_completed_at: '2026-09-16T14:00:00Z'
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('refund') + '#dossier-refund');
      const refund = finance(page).locator('#dossier-refund');
      await expect(refund).toBeFocused();
      await expect(refund).toBeInViewport();
      if (english) await useEnglish(page);

      const creditWarning = finance(page).getByText(
        english
          ? 'A credit note is missing or does not cover the confirmed refund.'
          : 'Note de crédit manquante ou couverture insuffisante pour le remboursement confirmé.',
        { exact: true }
      );
      await expect(refund).toContainText(english ? '123.45' : '123,45');
      await expect(refund).toContainText(english ? 'Partial' : 'Partiel');
      await expect(creditWarning).toHaveCount(1);
      await expect(finance(page).locator('#dossier-billing')).toContainText(
        'FAC-DEMO-401'
      );
      await expect(
        finance(page).locator('[data-og7="dossier-refund-history"]')
      ).toContainText('re_synthetic_partial');
      await expectResponsiveFinance(page);
      await finance(page).screenshot({
        path: `test-results/admin-finance-partial-${locale}-${width}.png`
      });
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }

  test('finance zone preserves focus moved to another control while a retry is pending', async ({
    page
  }) => {
    const { options, calls } = await fixtures(page, 'reader');
    options.status = 500;
    await page.goto(path('billing'));
    const retry = progress(page).getByRole('button', {
      name: 'Réessayer',
      exact: true
    });
    await expect(retry).toBeVisible();

    let release!: () => void;
    options.status = 200;
    options.progressGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const overview = page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Aperçu', exact: true });
    try {
      await retry.focus();
      await retry.press('Enter');
      await expect(progress(page)).toHaveAttribute('aria-busy', 'true');
      await expect(progress(page)).toBeFocused();
      await overview.focus();
      await expect(overview).toBeFocused();
    } finally {
      options.progressGate = null;
      release();
    }

    await expect(finance(page).locator('#dossier-billing')).toContainText(
      'FAC-DEMO-401'
    );
    await expect(progress(page)).toHaveAttribute('aria-busy', 'false');
    // Let any scheduled focus restoration run after the refreshed facts render.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await expect(overview).toBeFocused();
    await expect(page).toHaveURL(path('billing'));
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  for (const state of ['unavailable', 'empty', 'not_found'] as const) {
    test(`finance zone offers recovery for a ${state} projection without fabricating financial facts`, async ({
      page
    }) => {
      const { options, calls } = await fixtures(page, 'reader');
      options.state = state;
      await page.goto(path('billing'));
      await expect(progress(page)).toHaveAttribute('aria-busy', 'false');
      await expect(progress(page).getByRole('status')).toHaveCount(1);
      await expect(
        finance(page).locator('[data-og7="dossier-facts"]')
      ).toHaveCount(0);
      await expect(
        finance(page).locator('[data-og7="dossier-refund-history"]')
      ).toBeVisible();
      options.state = 'ok';
      await progress(page)
        .getByRole('button', { name: 'Réessayer', exact: true })
        .click();
      await expect(finance(page).locator('#dossier-billing')).toContainText(
        'FAC-DEMO-401'
      );
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }
}
