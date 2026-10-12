import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  PublicationAutomationCommand,
  PublicationReliability
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';

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
  ] as const)
    test(`global publication reliability remains independent of the filtered page in ${locale} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        (language) => localStorage.setItem('openg7.language', language),
        locale
      );
      const reliability: PublicationReliability = {
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
      };
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
}
