import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  PublicationAutomationCommand,
  PublicationReliability
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';

const reliabilityFixture = (): PublicationReliability => ({
  scope: 'global',
  evaluatedAt: '2030-06-01T12:00:00Z',
  obligations: {
    open: 650,
    undatedSocial: 648,
    oldestOpenAt: '2030-05-22T12:00:00Z',
    oldestUndatedAt: '2030-05-23T12:00:00Z',
    fulfilledWithEvidence: 3,
    waived: 2,
    unqualifiedDossiers: 7
  },
  capacity: {
    saturatedBatches: 4,
    saturatedSlots: 5,
    accountConflicts: 1
  },
  deliveries: {
    publishing: 2,
    uncertain: 1,
    uncertainAccounts: 1,
    oldestUncertainAccountAt: '2030-05-31T12:00:00Z',
    overdueApproved: 6
  },
  discrepancies: {
    proof: 1,
    orphanProof: 0,
    obligationReservation: 0,
    accountReservation: 0,
    accountLease: 0,
    batchCapacity: 0,
    slotCapacity: 0
  },
  incidents: [
    {
      code: 'FULFILMENT_EVIDENCE_MISMATCH',
      subjectType: 'obligation',
      subjectId: '22222222-2222-4222-8222-222222222222'
    }
  ],
  incidentTotal: 72,
  correlationLimit: 50
});

export function registerPublicationReliabilityTests({
  setup
}: {
  setup: (
    page: Page,
    reliability: PublicationReliability
  ) => Promise<PublicationAutomationCommand[]>;
}): void {
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    test(`global publication reliability remains independent of the filtered page in ${locale} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        (language) => localStorage.setItem('openg7.language', language),
        locale
      );
      const reliability = reliabilityFixture();
      const commands = await setup(page, reliability);
      await page.goto(
        '/admin/fundraiser/publications/automation?sponsorshipId=77777777-7777-4777-8777-777777777777'
      );
      const panel = page.locator('[data-og7="publication-reliability"]');
      await panel.locator('summary').click();
      await expect(panel).toContainText(
        locale === 'en' ? 'Global scope' : 'Périmètre global'
      );
      await expect(panel.getByText('650', { exact: true })).toBeVisible();
      await expect(panel.getByText('648', { exact: true })).toBeVisible();
      await expect(panel.getByText('240', { exact: true })).toBeVisible();
      await expect(panel).toContainText(
        locale === 'en' ? '1 of 72' : '1 sur 72'
      );
      await expect(panel.locator('code')).toHaveText(
        '22222222-2222-4222-8222-222222222222'
      );
      expect(commands).toHaveLength(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      const audit = await new AxeBuilder({ page })
        .include('[data-og7="publication-reliability"]')
        .analyze();
      expect(
        audit.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical'
        )
      ).toEqual([]);
    });
    test(`actionable reliability pages, exact links and stale snapshot recovery in ${locale} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        (language) => localStorage.setItem('openg7.language', language),
        locale
      );
      const commands = await setup(page, reliabilityFixture());
      const identifier = (n: number) =>
        `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
      const incidents = Array.from({ length: 75 }, (_, n) => ({
        code: 'ACCOUNT_RESULT_UNCERTAIN',
        subjectType: 'delivery',
        subjectId: identifier(n),
        deliveryId: identifier(n),
        ...(n === 0
          ? {
              sponsorshipId: identifier(100),
              batchId: identifier(101),
              slotId: identifier(102)
            }
          : {})
      }));
      const requests: URL[] = [];
      let changed = false;
      await page.route(
        '**/api/admin/publication-automation/incidents**',
        async (route) => {
          expect(route.request().method()).toBe('GET');
          const request = new URL(route.request().url());
          requests.push(request);
          const cursor = request.searchParams.get('cursor');
          if (changed && cursor)
            return route.fulfill({
              status: 409,
              json: { code: 'RELIABILITY_SNAPSHOT_CHANGED' }
            });
          return route.fulfill({
            json: {
              scope: 'global',
              evaluatedAt: '2030-06-01T12:00:00Z',
              globalTotal: 120,
              filteredTotal: 75,
              limit: 50,
              incidents: cursor ? incidents.slice(50) : incidents.slice(0, 50),
              snapshot: 'a'.repeat(32),
              nextCursor: cursor ? null : 'synthetic-next'
            }
          });
        }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?sponsorshipId=77777777-7777-4777-8777-777777777777'
      );
      const panel = page.locator('[data-og7="publication-reliability"]');
      await panel.locator('summary').click();
      const refresh = panel.getByRole('button', {
        name: locale === 'en' ? 'Refresh incidents' : 'Actualiser les incidents'
      });
      await refresh.focus();
      await page.keyboard.press('Enter');
      await expect(
        panel.locator('[data-og7="publication-reliability-incident"]')
      ).toHaveCount(50);
      await expect(
        panel.locator('[data-og7="publication-reliability-page-status"]')
      ).toContainText('120');
      const first = panel
        .locator('[data-og7="publication-reliability-incident"]')
        .first();
      await expect(first).toContainText(
        locale === 'en' ? 'Expected action' : 'Action attendue'
      );
      await expect(first).toContainText(
        locale === 'en' ? 'blind retry' : 'tentative aveugle'
      );
      for (const [path, query] of [
        ['/admin/fundraiser/sponsors', `sponsorshipId=${identifier(100)}`],
        [
          '/admin/fundraiser/publications/automation',
          `deliveryId=${identifier(0)}`
        ],
        [
          '/admin/fundraiser/publications/batches',
          `batchId=${identifier(101)}`
        ],
        ['/admin/fundraiser/publications/calendar', `slotId=${identifier(102)}`]
      ])
        await expect(first.locator(`a[href*="${query}"]`)).toHaveAttribute(
          'href',
          new RegExp(`^${path}\\?`)
        );
      const next = panel.getByRole('button', {
        name: locale === 'en' ? 'Next page' : 'Page suivante'
      });
      await next.focus();
      await page.keyboard.press('Enter');
      await expect(
        panel.locator('[data-og7="publication-reliability-incident"]')
      ).toHaveCount(25);
      await expect(next).toBeDisabled();
      expect(requests.at(-1)?.searchParams.get('cursor')).toBe(
        'synthetic-next'
      );
      await panel
        .getByRole('button', {
          name: locale === 'en' ? 'Previous page' : 'Page précédente'
        })
        .click();
      await expect(
        panel.locator('[data-og7="publication-reliability-incident"]')
      ).toHaveCount(50);
      await panel
        .getByRole('combobox', {
          name: locale === 'en' ? 'Incident type' : 'Type d’incident'
        })
        .selectOption('ACCOUNT_RESULT_UNCERTAIN');
      await expect
        .poll(() => requests.at(-1)?.searchParams.get('code'))
        .toBe('ACCOUNT_RESULT_UNCERTAIN');
      expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
      await panel
        .getByRole('combobox', {
          name: locale === 'en' ? 'Affected object' : 'Objet concerné'
        })
        .selectOption('delivery');
      await expect
        .poll(() => requests.at(-1)?.searchParams.get('subjectType'))
        .toBe('delivery');
      changed = true;
      await next.click();
      await expect(panel.getByRole('alert')).toContainText(
        locale === 'en' ? 'Incidents have changed' : 'Les incidents ont changé'
      );
      await expect(next).toBeDisabled();
      await refresh.click();
      await expect(panel.getByRole('alert')).toHaveCount(0);
      expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
      await expect(panel.getByText('650', { exact: true })).toBeVisible();
      expect(commands).toHaveLength(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      const audit = await new AxeBuilder({ page })
        .include('[data-og7="publication-reliability"]')
        .analyze();
      expect(
        audit.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical'
        )
      ).toEqual([]);
    });
  }
}
