import type { Locator, Page } from '@playwright/test';
import type { AdminSponsorshipRecord } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface HistoryPanelTestContext {
  readonly fixtures: (
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ) => Promise<{
    readonly calls: readonly { readonly method: string }[];
    readonly options: {
      readonly edited: Map<string, Partial<AdminSponsorshipRecord>>;
    };
  }>;
  readonly path: (tab?: string, value?: string) => string;
  readonly tabs: (page: Page) => Locator;
}

const id = '10000000-0000-4000-8000-000000000401';
const date = '2026-09-16T14:00:00Z';

/** Uses the page suite's synthetic fixtures without creating financial effects. */
export function registerSponsorHistoryPanelTests({
  fixtures,
  path,
  tabs
}: HistoryPanelTestContext): void {
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    const english = locale === 'en';

    test(`extracted refund history preserves projected facts, notes and chronology in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'reader');
      options.edited.set(id, {
        sponsorship_refund_status: 'completed',
        sponsorship_refund_requested_at: '2026-09-14T14:00:00Z',
        sponsorship_refund_processed_at: '2026-09-15T14:00:00Z',
        sponsorship_refund_completed_at: date,
        sponsorship_refund_amount: 125.25,
        sponsorship_refund_reason: 'requested_by_customer',
        sponsorship_refund_id: 're_synthetic_history',
        sponsorship_refund_note: 'Synthetic refund note\nSecond line',
        sponsorship_refund_error: 'Synthetic document error',
        admin_audit_entries: [
          {
            id: 'synthetic-refund-audit',
            actor: 'Synthetic history operator',
            action: 'sponsorship_refund.stripe_partial',
            entity_type: 'contribution',
            entity_id: id,
            summary: 'Synthetic refund audit',
            metadata: {
              amount: 12525,
              currency: 'CAD',
              fullRefund: false,
              refundId: 're_synthetic_history'
            },
            created_at: date
          },
          {
            id: 'synthetic-unrelated-audit',
            actor: 'Synthetic history operator',
            action: 'sponsorship.logo.upload',
            entity_type: 'contribution',
            entity_id: id,
            summary: 'Synthetic unrelated audit',
            metadata: {},
            created_at: date
          }
        ]
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('billing'));
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const history = page.locator('[data-og7="dossier-refund-history"]');
      await expect(
        history.getByRole('heading', {
          name: english ? 'Refund tracking' : 'Suivi remboursement',
          exact: true
        })
      ).toBeVisible();
      await expect(history).toContainText('re_synthetic_history');
      await expect(history).toContainText('Synthetic refund note');
      await expect(history).toContainText('Second line');
      await expect(history).toContainText('Synthetic document error');
      await expect(history).toContainText(english ? '125.25' : '125,25');
      const milestones = history.locator(
        '[data-og7="dossier-refund-timeline"] li'
      );
      await expect(milestones).toHaveCount(3);
      expect(
        await milestones.evaluateAll((entries) =>
          entries.map((entry) => entry.getAttribute('data-og7-id'))
        )
      ).toEqual([
        `${id}:refund-requested`,
        `${id}:refund-processing`,
        `${id}:refund-completed`
      ]);
      const events = history.locator('[data-og7="dossier-refund-audit"] li');
      await expect(events).toHaveCount(1);
      await expect(events.first()).toHaveAttribute(
        'data-og7-id',
        'synthetic-refund-audit'
      );
      await expect(events).toContainText('Synthetic history operator');
      await expect(history.locator('button, input, textarea')).toHaveCount(0);
      await expect(page.locator('#dossier-billing')).toContainText(
        'FAC-DEMO-401'
      );
      await expect(page.locator('#dossier-refund')).toContainText(
        english ? '200.00' : '200,00'
      );
      await expect(
        history.locator('[data-og7="interventions-history"]')
      ).toHaveCount(0);
      const columns = await history
        .locator('[data-og7="dossier-refund-summary"]')
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(' ').length
        );
      expect(columns).toBe(english ? 1 : 2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`extracted audit inspection preserves reader access and keyboard focus in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'reader');
      options.edited.set(id, {
        admin_audit_entries: [
          {
            id: 'synthetic-history-inspection',
            actor: 'Synthetic audit reader',
            action: 'synthetic.history.inspection',
            entity_type: 'contribution',
            entity_id: id,
            summary: 'Synthetic inspected history',
            metadata: {},
            created_at: date
          }
        ]
      });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path('audit'));
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const history = page.locator('[data-og7="dossier-audit-history"]');
      await expect(history).toContainText('Synthetic inspected history');
      const anchor = page.locator('#dossier-audit');
      await anchor.focus();
      await expect(anchor).toBeFocused();
      const opener = history.getByRole('button', {
        name: english ? 'Dossier history' : 'Historique du dossier',
        exact: true
      });
      await opener.focus();
      await opener.press('Enter');
      const inspection = page.locator('dialog[open]');
      await expect(inspection).toContainText('Synthetic inspected history');
      await expect(inspection).toContainText('Synthetic audit reader');
      await expect(inspection).toContainText(id);
      await page.keyboard.press('Escape');
      await expect(inspection).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(page).toHaveURL(path('audit'));
      await expect(
        history.locator('[data-og7="interventions-history"]')
      ).toHaveCount(0);
      await tabs(page)
        .getByRole('button', {
          name: english ? 'Overview' : 'Aperçu',
          exact: true
        })
        .click();
      await expect(history).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }
}
