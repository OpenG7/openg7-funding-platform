import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';

interface QualityContext {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<unknown>;
  path(tab?: string, value?: string): string;
}

const qualityPath = '/admin/fundraiser/sponsors/quality';

async function fixtures(
  page: Page,
  context: QualityContext,
  role: 'owner' | 'operator' | 'reader' = 'owner'
) {
  await context.fixtures(page, role);
  const contributionId = new URL(
    context.path(),
    'http://admin.invalid'
  ).searchParams.get('sponsorshipId')!;
  const state = {
    inventoryQueries: [] as URL[],
    auditQueries: [] as URL[],
    mutations: 0,
    failInventory: false
  };
  await page.route(
    '**/api/admin/sponsorship-commitments/adoption-preview**',
    async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET') state.mutations++;
      state.inventoryQueries.push(url);
      if (state.failInventory)
        return route.fulfill({
          status: 503,
          json: { code: 'COMMITMENT_UNAVAILABLE' }
        });
      return route.fulfill({
        json: {
          pageSize: Number(url.searchParams.get('pageSize')),
          nextCursor: url.searchParams.has('cursor')
            ? null
            : 'synthetic-inventory-cursor',
          items: [
            {
              contributionId,
              reference: 'SYNTHETIC-QUALITY',
              paymentStatus: 'paid',
              amountMinor: 50000,
              currency: 'CAD',
              commitmentId: null,
              classification: 'legacy_declarations',
              offerVersion: null,
              obligationCount: 0,
              fulfilledWithEvidenceCount: 0,
              historicalDeclarationCount: 3
            }
          ]
        }
      });
    }
  );
  await page.route(
    '**/api/admin/sponsorship-commitments/historical-audit**',
    async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET') state.mutations++;
      state.auditQueries.push(url);
      return route.fulfill({
        json: {
          pageSize: 25,
          nextCursor: url.searchParams.has('cursor')
            ? null
            : 'synthetic-audit-cursor',
          asOf: '2026-10-12T00:00:00.000Z',
          totals: {
            evidence: 155,
            filtered: 55,
            unreviewed: 30,
            durationUnverified: 12,
            requiredElementMissing: 14,
            snapshotIncomplete: 8,
            noIssueDetected: 121
          },
          items: [
            {
              contributionId,
              evidenceId: '10000000-0000-4000-8000-000000000602',
              obligationId: '10000000-0000-4000-8000-000000000603',
              benefitId: 'website_mention',
              channel: 'website',
              target: 'openg7',
              deliveredAt: '2026-10-01T00:00:00.000Z',
              durationDays: 30,
              requirements: [],
              findings: ['duration_unverified'],
              reviewVersion: 0,
              latestReview: null
            }
          ]
        }
      });
    }
  );
  return { state, contributionId };
}

export function registerSponsorsQualityTests(context: QualityContext): void {
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    test(`sponsorship quality separates portfolio inventory and dossier evidence in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { state, contributionId } = await fixtures(page, context);
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(qualityPath);
      expect(response?.status()).toBe(200);
      if (locale === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const quality = page.locator('[data-og7="sponsors-quality-page"]');
      await expect(quality.getByRole('heading', { level: 1 })).toHaveText(
        locale === 'en' ? 'Sponsorship quality' : 'Qualité des commandites'
      );
      expect(state.inventoryQueries).toHaveLength(0);
      expect(state.auditQueries).toHaveLength(0);
      await quality.locator('[data-og7="commitments-adoption-load"]').click();
      await expect(
        quality.locator('[data-og7="commitments-adoption"]')
      ).toContainText('SYNTHETIC-QUALITY');
      expect(state.inventoryQueries[0]!.searchParams.get('pageSize')).toBe(
        '25'
      );
      await quality.locator('[data-og7="commitments-adoption-next"]').click();
      await expect.poll(() => state.inventoryQueries.length).toBe(2);
      expect(state.inventoryQueries[1]!.searchParams.get('cursor')).toBe(
        'synthetic-inventory-cursor'
      );
      const audit = quality.locator('[data-og7="historical-evidence-audit"]');
      await audit.locator('[data-og7-id="historical-audit-load"]').click();
      await expect(
        audit.locator('[data-og7-id="historical-audit-counts"]')
      ).toContainText('155');
      expect(state.auditQueries[0]!.searchParams.has('contributionId')).toBe(
        false
      );
      await audit.locator('[data-og7-id="historical-audit-next"]').click();
      await expect.poll(() => state.auditQueries.length).toBe(2);
      expect(state.auditQueries[1]!.searchParams.get('cursor')).toBe(
        'synthetic-audit-cursor'
      );
      expect(state.mutations).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      const dossierLink = quality
        .locator('[data-og7="commitments-adoption"] a')
        .first();
      await expect(dossierLink).toHaveAttribute(
        'href',
        new RegExp('sponsorshipId=' + contributionId)
      );
      await dossierLink.click();
      await expect(page).toHaveURL(/tab=publication/);
      await expect(
        page.locator('[data-og7="commitments-adoption"]')
      ).toHaveCount(0);
      const localAudit = page.locator('[data-og7="historical-evidence-audit"]');
      await localAudit.locator('[data-og7-id="historical-audit-load"]').click();
      await expect(
        localAudit.locator('[data-og7-id="historical-audit-counts"]')
      ).toContainText('55');
      await expect(
        localAudit.locator('[data-og7-id="historical-audit-counts"]')
      ).not.toContainText('155');
      expect(
        state.auditQueries.at(-1)!.searchParams.get('contributionId')
      ).toBe(contributionId);
      await expect(localAudit.getByRole('checkbox')).toHaveCount(0);
      await localAudit
        .locator('[data-og7="historical-audit-open-quality"]')
        .click();
      await expect(page).toHaveURL(
        new RegExp('sponsors/quality\\?returnSponsorshipId=' + contributionId)
      );
      await expect(
        page.locator('[data-og7="sponsors-quality-page"] header a')
      ).toHaveAttribute('href', new RegExp('sponsorshipId=' + contributionId));
    });
  }

  for (const role of ['operator', 'reader'] as const) {
    test(`sponsorship quality excludes owner inventory and queries for ${role}`, async ({
      page
    }) => {
      const { state } = await fixtures(page, context, role);
      await page.goto(qualityPath);
      await expect(
        page.locator('[data-og7="sponsors-quality-owner-required"]')
      ).toBeVisible();
      await expect(
        page.locator('nav a[href="' + qualityPath + '"]')
      ).toHaveCount(0);
      await expect(
        page.locator('[data-og7="commitments-adoption"]')
      ).toHaveCount(0);
      await expect(
        page.locator('[data-og7="historical-evidence-audit"]')
      ).toHaveCount(0);
      expect(state.inventoryQueries).toHaveLength(0);
      expect(state.auditQueries).toHaveLength(0);
      expect(state.mutations).toBe(0);
    });
  }

  test('sponsorship quality exposes a failed read and recovers without a mutation', async ({
    page
  }) => {
    const { state } = await fixtures(page, context);
    state.failInventory = true;
    await page.goto(qualityPath);
    const inventory = page.locator('[data-og7="commitments-adoption"]');
    await inventory.locator('[data-og7="commitments-adoption-load"]').click();
    await expect(inventory.getByRole('alert')).toBeVisible();
    state.failInventory = false;
    await inventory.locator('[data-og7="commitments-adoption-load"]').click();
    await expect(inventory).toContainText('SYNTHETIC-QUALITY');
    expect(state.mutations).toBe(0);
  });
}
