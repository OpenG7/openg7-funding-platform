import type { Page } from '@playwright/test';
import type { SponsorshipHistoricalAuditReviewRequest } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface Context {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<unknown>;
  path(tab?: string, value?: string): string;
}
const evidenceId = '10000000-0000-4000-8000-000000000602';
const item = {
  evidenceId,
  obligationId: '10000000-0000-4000-8000-000000000603',
  contributionId: '10000000-0000-4000-8000-000000000401',
  benefitId: 'website_mention',
  channel: 'website',
  target: 'openg7',
  deliveredAt: '2026-10-01T00:00:00.000Z',
  durationDays: 30,
  requirements: [{ element: 'approved_logo', observation: 'missing' }],
  findings: ['duration_unverified', 'required_element_missing'],
  reviewVersion: 0,
  latestReview: null
};
async function fixtures(page: Page, context: Context) {
  await context.fixtures(page);
  const state = {
    failure: 0,
    version: 0,
    commands: [] as SponsorshipHistoricalAuditReviewRequest[],
    queries: [] as string[]
  };
  await page.route(
    '**/api/admin/sponsorship-commitments/historical-audit**',
    async (route) => {
      if (route.request().method() === 'GET') {
        state.queries.push(route.request().url());
        return route.fulfill({
          json: {
            items: [{ ...item, reviewVersion: state.version }],
            pageSize: 25,
            nextCursor: 'synthetic-next-cursor',
            asOf: '2026-10-12T00:00:00.000Z',
            totals: {
              evidence: 155,
              filtered: 55,
              unreviewed: 30,
              durationUnverified: 12,
              requiredElementMissing: 14,
              snapshotIncomplete: 8,
              noIssueDetected: 121
            }
          }
        });
      }
      const input = route
        .request()
        .postDataJSON() as SponsorshipHistoricalAuditReviewRequest;
      state.commands.push(input);
      if (state.failure)
        return route.fulfill({
          status: state.failure,
          json: {
            code:
              state.failure === 409
                ? 'HISTORICAL_AUDIT_VERSION_CONFLICT'
                : 'HISTORICAL_AUDIT_UNAVAILABLE'
          }
        });
      state.version++;
      return route.fulfill({
        json: {
          evidenceId,
          reviewVersion: state.version,
          review: {
            id: '10000000-0000-4000-8000-000000000604',
            conclusion: input.conclusion,
            reviewedAt: '2026-10-12T00:00:00.000Z'
          }
        }
      });
    }
  );
  return state;
}
export function registerSponsorshipHistoricalAuditTests(
  context: Context
): void {
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    test(`historical audit owner reviews immutable evidence in ${locale} at ${width}px`, async ({
      page
    }) => {
      const state = await fixtures(page, context);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(context.path('publication'));
      if (locale === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const panel = page.locator('[data-og7="historical-evidence-audit"]');
      await panel.locator('[data-og7-id="historical-audit-load"]').click();
      await expect(
        panel.locator('[data-og7-id="historical-audit-counts"]')
      ).toContainText('155');
      await expect(
        panel.locator('[data-og7-id="historical-audit-item"]')
      ).toContainText(evidenceId);
      await panel.locator('[data-og7-id="historical-audit-next"]').click();
      await expect.poll(() => state.queries.length).toBe(2);
      expect(new URL(state.queries[1]!).searchParams.get('cursor')).toBe(
        'synthetic-next-cursor'
      );
      await panel.locator('[data-og7-id="historical-audit-review"]').click();
      const form = panel.locator('form');
      await expect(
        form.locator('[data-og7-id="historical-audit-save"]')
      ).toBeDisabled();
      await form
        .locator('textarea')
        .fill('Synthetic private historical examination');
      await form.locator('select').selectOption('follow_up_required');
      await form.locator('input[type="checkbox"]').check();
      await form.locator('[data-og7-id="historical-audit-save"]').click();
      await expect.poll(() => state.commands.length).toBe(1);
      expect(state.commands[0]!.confirmation).toBe(evidenceId);
      expect(state.commands[0]!.expectedVersion).toBe(0);
      await expect(panel.locator('[role="status"]')).toContainText(
        locale === 'en' ? 'Review recorded' : 'Examen enregistré'
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
  test('historical audit preserves uncertain commands and clears a definite version conflict', async ({
    page
  }) => {
    const state = await fixtures(page, context);
    await page.goto(context.path('publication'));
    const panel = page.locator('[data-og7="historical-evidence-audit"]');
    await panel.locator('[data-og7-id="historical-audit-load"]').click();
    await panel.locator('[data-og7-id="historical-audit-review"]').click();
    await panel.locator('textarea').fill('Synthetic exact command');
    await panel.locator('form input[type="checkbox"]').check();
    state.failure = 503;
    await panel.locator('[data-og7-id="historical-audit-save"]').click();
    await expect(
      panel.locator('[data-og7-id="historical-audit-retry"]')
    ).toBeVisible();
    const original = structuredClone(state.commands[0]);
    state.failure = 409;
    await panel.locator('[data-og7-id="historical-audit-retry"]').click();
    await expect(
      panel.locator('[data-og7-id="historical-audit-retry"]')
    ).toHaveCount(0);
    expect(state.commands[1]).toEqual(original);
    state.failure = 0;
    state.version = 1;
    await panel.locator('[data-og7-id="historical-audit-load"]').click();
    await panel.locator('[data-og7-id="historical-audit-review"]').click();
    await panel.locator('textarea').fill('Synthetic refreshed review');
    await panel.locator('form input[type="checkbox"]').check();
    await panel.locator('[data-og7-id="historical-audit-save"]').click();
    await expect.poll(() => state.commands.length).toBe(3);
    expect(state.commands[2]!.expectedVersion).toBe(1);
    expect(state.commands[2]!.requestId).not.toBe(original!.requestId);
  });
}
