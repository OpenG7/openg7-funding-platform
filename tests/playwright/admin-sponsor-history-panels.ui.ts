import type { Locator, Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
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
const hostile = '<img src=x onerror="alert(1)">';
const actorReference = `admin:synthetic-${'reference'.repeat(28)}${hostile}`;

/** Uses the page suite's synthetic fixtures without creating financial effects. */
export function registerSponsorHistoryPanelTests({
  fixtures,
  path,
  tabs
}: HistoryPanelTestContext): void {
  for (const locale of ['fr-CA', 'en'] as const) {
    for (const width of [1536, 390, 1280, 768]) {
      test(`history sources preserve dossier scope and consultation rights in ${locale} at ${width}px`, async ({
        page
      }, testInfo) => {
        const reader = width === 390;
        const { calls } = await fixtures(page, reader ? 'reader' : 'owner');
        await page.addInitScript(
          (value) => localStorage.setItem('openg7.language', value),
          locale
        );
        const shortViewport = width === 1280 || width === 768;
        await page.setViewportSize({
          width,
          height: width === 1280 ? 520 : width === 768 ? 432 : 864
        });
        await page.goto(path('audit'));
        const history = page.locator('[data-og7="dossier-audit-history"]');
        const sources = page.locator('[data-og7="dossier-history-sources"]');
        await expect(sources).toBeVisible();
        await expect(sources).toContainText(
          locale === 'en' ? 'History sources' : 'Sources de l’historique'
        );
        await expect(
          sources.locator('[data-og7-id="evidence"]')
        ).toHaveAttribute(
          'href',
          `/admin/fundraiser/campaigns?sponsorshipId=${id}`
        );
        const preparation = sources.locator('[data-og7-id="preparation"]');
        await expect(preparation).toHaveAttribute(
          'href',
          path('publication') + '#dossier-preparation'
        );
        await expect(sources.locator('[data-og7-id="moderation"]')).toHaveCount(
          reader ? 0 : 1
        );
        const filter = history.getByRole('combobox');
        await filter.selectOption('publication');
        const journal = sources.locator('[data-og7-id="interventions"]');
        await expect(journal).toBeEnabled();
        await journal.focus();
        await page.keyboard.press('Enter');
        const dialog = page.locator('dialog[open]');
        await expect(dialog).toHaveCount(1);
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(journal).toBeFocused();
        await expect(filter).toHaveValue('publication');
        await expect(page).toHaveURL(path('audit'));
        if (!reader) {
          const moderation = sources.locator('[data-og7-id="moderation"]');
          await moderation.focus();
          await page.keyboard.press('Enter');
          const close = page.locator('[data-og7="dossier-tool-close"]');
          await expect(close).toBeFocused();
          await close.click();
          await expect(moderation).toBeFocused();
          await expect(filter).toHaveValue('publication');
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="dossier-history-sources"]')
              .analyze()
          ).violations
        ).toEqual([]);
        if (shortViewport) {
          const lastLink = sources.getByRole('link').last();
          await lastLink.focus();
          await expect(lastLink).toBeFocused();
          await expect
            .poll(() =>
              lastLink.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const x = bounds.left + bounds.width / 2;
                const y = bounds.top + bounds.height / 2;
                const hit = document.elementFromPoint(x, y);
                return (
                  x >= 0 &&
                  x <= innerWidth &&
                  y >= 0 &&
                  y <= innerHeight &&
                  !!hit &&
                  (hit === element || element.contains(hit))
                );
              })
            )
            .toBe(true);
        }
        await page.screenshot({
          path: testInfo.outputPath(`history-sources-${locale}-${width}.png`),
          fullPage: false,
          animations: 'disabled'
        });
        await preparation.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(
          path('publication') + '#dossier-preparation'
        );
        await expect(page.locator('#dossier-preparation')).toBeFocused();
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }
  }
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    const english = locale === 'en';

    test(`activity domains filter known and unknown events while preserving full audit inspection in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'reader');
      options.edited.set(id, {
        sponsor_visibility_updated_at: null,
        admin_audit_entries: [
          {
            id: 'synthetic-filter-finances',
            actor: 'Synthetic finance reader',
            action: 'sponsorship_refund.stripe_partial',
            entity_type: 'contribution',
            entity_id: id,
            summary: 'Synthetic finance activity',
            metadata: { amount: 12525, currency: 'CAD' },
            created_at: '2026-09-19T14:00:00Z'
          },
          {
            id: 'synthetic-filter-profile',
            actor: 'Synthetic profile reader',
            action: 'sponsorship.logo.upload',
            entity_type: 'contribution',
            entity_id: id,
            summary: 'Synthetic profile activity',
            metadata: {},
            created_at: '2026-09-18T14:00:00Z'
          },
          {
            id: 'synthetic-filter-other',
            actor: 'Synthetic audit reader',
            action: 'future.unknown_action',
            entity_type: 'contribution',
            entity_id: id,
            summary: 'Synthetic unclassified activity',
            metadata: {},
            created_at: '2026-09-17T14:00:00Z'
          }
        ]
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('audit'));
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const history = page.locator('[data-og7="dossier-audit-history"]');
      const filter = history.getByRole('combobox', {
        name: english ? 'Filter activity' : 'Filtrer l’activité',
        exact: true
      });
      await filter.focus();
      await filter.selectOption('finances');
      await expect(filter).toBeFocused();
      await expect(
        history.locator('[data-og7-id="synthetic-filter-finances"]')
      ).toBeVisible();
      await expect(
        history.locator('[data-og7-id="synthetic-filter-profile"]')
      ).toHaveCount(0);
      await expect(
        history.locator('[data-og7-id="synthetic-filter-other"]')
      ).toHaveCount(0);
      await expect(
        history.locator('[data-og7="dossier-audit-summary"]')
      ).toContainText(english ? ' of ' : ' sur ');
      const inspect = history.getByRole('button', {
        name: english ? 'View audit log' : 'Consulter le journal',
        exact: true
      });
      await inspect.focus();
      await inspect.press('Enter');
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toContainText('Synthetic profile reader');
      await expect(dialog).toContainText('Synthetic unclassified activity');
      await page.keyboard.press('Escape');
      await expect(inspect).toBeFocused();
      await filter.selectOption('publication');
      await expect(
        history.locator('[data-og7="dossier-audit-filter-empty"]')
      ).toHaveText(
        english ? 'No events in this area.' : 'Aucun événement dans ce domaine.'
      );
      await filter.selectOption('other');
      await expect(
        history.locator('[data-og7="dossier-audit-events"] li')
      ).toHaveCount(1);
      await expect(history).toContainText('Synthetic unclassified activity');
      await filter.selectOption('all');
      await expect(
        history.locator('[data-og7-id="synthetic-filter-finances"]')
      ).toBeVisible();
      await expect(
        history.locator('[data-og7-id="synthetic-filter-profile"]')
      ).toBeVisible();
      expect(
        await history.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1
        )
      ).toBe(true);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

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
            actor: actorReference,
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
          name: english ? 'Refund tracking' : 'Suivi des remboursements',
          exact: true
        })
      ).toBeVisible();
      await expect(history).toContainText('re_synthetic_history');
      await expect(history).toContainText('Synthetic refund note');
      await expect(history).toContainText('Second line');
      await expect(history).toContainText('Synthetic document error');
      await expect(history).toContainText(english ? '125.25' : '125,25');
      const milestoneList = history.getByRole('list', {
        name: english ? 'Refund milestones' : 'Jalons du remboursement',
        exact: true
      });
      await expect(milestoneList).toHaveAttribute(
        'data-og7',
        'dossier-refund-timeline'
      );
      await expect(milestoneList).toHaveAttribute('role', 'list');
      const milestones = milestoneList.locator('li');
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
      expect(
        await milestones
          .locator('time')
          .evaluateAll((times) =>
            times.map((time) => time.getAttribute('datetime'))
          )
      ).toEqual(['2026-09-14T14:00:00Z', '2026-09-15T14:00:00Z', date]);
      const auditList = history.getByRole('list', {
        name: english
          ? 'Related admin actions'
          : 'Actions administratives liées',
        exact: true
      });
      await expect(auditList).toHaveAttribute(
        'data-og7',
        'dossier-refund-audit'
      );
      await expect(auditList).toHaveAttribute('role', 'list');
      const events = auditList.locator('li');
      await expect(events).toHaveCount(1);
      await expect(events.first()).toHaveAttribute(
        'data-og7-id',
        'synthetic-refund-audit'
      );
      const disclosure = events.locator('details');
      await expect(disclosure).not.toHaveAttribute('open', '');
      const actorCode = disclosure.locator('code');
      await expect(actorCode).not.toBeVisible();
      const actorSummary = disclosure.locator('summary');
      await expect(actorSummary).toContainText(english ? 'Actor' : 'Acteur');
      await expect(actorSummary).not.toContainText(actorReference);
      await actorSummary.focus();
      await actorSummary.press('Enter');
      await expect(actorCode).toBeVisible();
      await expect(actorCode).toHaveText(actorReference);
      await expect(history.locator('img, script, [onerror]')).toHaveCount(0);
      const historyWidth = await history.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }));
      expect(
        historyWidth.scrollWidth,
        `Refund history width: scrollWidth=${historyWidth.scrollWidth}px, clientWidth=${historyWidth.clientWidth}px`
      ).toBeLessThanOrEqual(historyWidth.clientWidth + 1);
      await history.screenshot({
        path: `test-results/admin-refund-history-${locale}-${width}.png`
      });
      await actorSummary.press('Space');
      await expect(actorCode).not.toBeVisible();
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
      await expect(history).toContainText(
        english ? 'Latest processing amount' : 'Montant du dernier traitement'
      );
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
            actor: actorReference,
            action: 'synthetic.history.inspection',
            entity_type: 'contribution',
            entity_id: id,
            summary: `Synthetic inspected history ${hostile}`,
            metadata: {},
            created_at: '2026-09-18T14:00:00Z'
          },
          {
            id: 'synthetic-readable-actor',
            actor: 'Synthetic audit reader',
            action: 'synthetic.history.readable',
            entity_type: 'contribution',
            entity_id: id,
            summary: 'Synthetic readable actor history',
            metadata: {},
            created_at: '2026-09-17T14:00:00Z'
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
      const events = history.getByRole('list', {
        name: english ? 'Available history' : 'Historique disponible',
        exact: true
      });
      await expect(events).toHaveAttribute('data-og7', 'dossier-audit-events');
      await expect(events).toHaveAttribute('role', 'list');
      await expect(events.locator('li')).toHaveCount(5);
      const summary = history.locator('[data-og7="dossier-audit-summary"]');
      await expect(summary).toContainText(
        english ? '5 events' : '5 événements'
      );
      await expect(summary).toContainText(
        english ? 'Newest first' : 'Du plus récent au plus ancien'
      );
      await expect(history).toContainText(
        english
          ? 'Dossier milestones and latest available administrative actions.'
          : 'Jalons du dossier et dernières actions administratives disponibles.'
      );
      const technicalEvent = events.locator(
        '[data-og7-id="synthetic-history-inspection"]'
      );
      await expect(events.locator('li').first()).toHaveAttribute(
        'data-og7-id',
        'synthetic-history-inspection'
      );
      await expect(technicalEvent.locator('time')).toHaveAttribute(
        'datetime',
        '2026-09-18T14:00:00Z'
      );
      await expect(technicalEvent.locator('small')).toContainText(hostile);
      const actorDisclosure = technicalEvent.locator('details');
      const actorSummary = actorDisclosure.locator('summary');
      const actorCode = actorDisclosure.locator('code');
      await expect(actorCode).not.toBeVisible();
      await expect(actorSummary).toContainText(english ? 'Actor' : 'Acteur');
      await expect(actorSummary).not.toContainText(actorReference);
      await actorSummary.focus();
      await actorSummary.press('Enter');
      await expect(actorCode).toHaveText(actorReference);
      await expect(actorCode).toBeVisible();
      expect(
        await history.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1
        )
      ).toBe(true);
      await history.screenshot({
        path: `test-results/admin-history-${locale}-${width}.png`
      });
      await actorSummary.press('Space');
      await expect(actorCode).not.toBeVisible();
      const readableEvent = events.locator(
        '[data-og7-id="synthetic-readable-actor"]'
      );
      await expect(readableEvent).toContainText('Synthetic audit reader');
      await expect(readableEvent.locator('details')).toHaveCount(0);
      await expect(history.locator('img, script, [onerror]')).toHaveCount(0);
      const anchor = page.locator('#dossier-audit');
      await anchor.focus();
      await expect(anchor).toBeFocused();
      const opener = history.getByRole('button', {
        name: english ? 'View audit log' : 'Consulter le journal',
        exact: true
      });
      const controlSize = await opener.boundingBox();
      expect(controlSize?.height).toBeGreaterThanOrEqual(44);
      await opener.focus();
      await opener.press('Enter');
      const inspection = page.locator('dialog[open]');
      await expect(inspection).toContainText('Synthetic inspected history');
      await expect(inspection).toContainText('Synthetic audit reader');
      await expect(inspection).toContainText(id);
      await expect(inspection.locator('time').first()).toHaveAttribute(
        'datetime',
        '2026-09-18T14:00:00Z'
      );
      await expect(inspection.locator('time').first()).not.toHaveText(
        '2026-09-18T14:00:00Z'
      );
      await expect(inspection.locator('img, script, [onerror]')).toHaveCount(0);
      expect(
        await inspection.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1
        )
      ).toBe(true);
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
