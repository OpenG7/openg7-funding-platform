import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  SponsorshipHistoricalAuditItem,
  SponsorshipHistoricalAuditReviewRequest
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface Context {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<unknown>;
  path(tab?: string, value?: string): string;
}
const evidenceId = '10000000-0000-4000-8000-000000000602';
const item: SponsorshipHistoricalAuditItem = {
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
    queries: [] as string[],
    pages: {} as Record<string, readonly SponsorshipHistoricalAuditItem[]>
  };
  await page.route(
    '**/api/admin/sponsorship-commitments/historical-audit**',
    async (route) => {
      if (route.request().method() === 'GET') {
        state.queries.push(route.request().url());
        const cursor =
          new URL(route.request().url()).searchParams.get('cursor') ?? '';
        return route.fulfill({
          json: {
            items: (state.pages[cursor] ?? [item]).map((entry) => ({
              ...entry,
              reviewVersion: state.version
            })),
            pageSize: 25,
            nextCursor: cursor ? null : 'synthetic-next-cursor',
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
  for (const language of ['fr-CA', 'en'] as const) {
    for (const width of [1536, 390, 1280, 768]) {
      test(`historical audit describes available evidence and replaces its page in ${language} at ${width}px`, async ({
        page
      }, testInfo) => {
        const state = await fixtures(page, context);
        const reviewId = '10000000-0000-4000-8000-000000000604';
        state.pages[''] = [
          {
            ...item,
            latestReview: {
              id: reviewId,
              conclusion: 'inconclusive',
              reviewedAt: '2026-10-05T00:00:00.000Z'
            }
          }
        ];
        const second = {
          ...item,
          evidenceId: '10000000-0000-4000-8000-000000000605',
          obligationId: '10000000-0000-4000-8000-000000000606',
          channel: 'linkedin' as const,
          target: 'openg20' as const
        };
        state.pages['synthetic-next-cursor'] = [second];
        await page.addInitScript(
          (value) => localStorage.setItem('openg7.language', value),
          language
        );
        const shortViewport = width === 1280 || width === 768;
        await page.setViewportSize({
          width,
          height: width === 1280 ? 520 : width === 768 ? 432 : 864
        });
        await page.goto(context.path('publication'));
        const panel = page.locator('[data-og7="historical-evidence-audit"]');
        await panel.locator('[data-og7-id="historical-audit-load"]').click();
        await expect(
          panel.locator('[data-og7="historical-audit-as-of"] time')
        ).toHaveAttribute('datetime', '2026-10-12T00:00:00.000Z');
        await expect(
          panel.locator('[data-og7="historical-audit-as-of"]')
        ).toContainText('Toronto');
        await expect(
          panel.locator('[data-og7="historical-audit-page-summary"]')
        ).toContainText('1');
        await expect(
          panel.locator('[data-og7="historical-audit-page-summary"]')
        ).toContainText('25');
        await expect(
          panel.locator('[data-og7-id="historical-audit-counts"]')
        ).toContainText('55');
        const first = panel.locator('[data-og7-id="historical-audit-item"]');
        await expect(first).toContainText(
          language === 'en' ? 'Website' : 'Site Web'
        );
        await expect(
          first.locator('[data-og7="historical-audit-evidence-date"]')
        ).toContainText('30');
        await expect(
          first.locator('[data-og7="historical-audit-review-date"]')
        ).toContainText('4');
        await expect(
          first.locator('[data-og7="historical-audit-latest-review"]')
        ).toContainText(
          language === 'en'
            ? 'Latest available conclusion'
            : 'Dernière conclusion disponible'
        );
        const references = first.locator(
          '[data-og7="historical-audit-references"]'
        );
        await expect(references).not.toHaveAttribute('open', '');
        await references.locator('summary').focus();
        await page.keyboard.press('Enter');
        await expect(references).toHaveAttribute('open', '');
        await expect(references).toContainText(evidenceId);
        await expect(references).toContainText(item.obligationId);
        await expect(
          first.locator('[data-og7="historical-audit-open-evidence"]')
        ).toHaveAttribute(
          'href',
          `/admin/fundraiser/campaigns?sponsorshipId=${item.contributionId}&obligationId=${item.obligationId}`
        );
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="historical-evidence-audit"]')
              .analyze()
          ).violations
        ).toEqual([]);
        const next = panel.locator('[data-og7-id="historical-audit-next"]');
        if (shortViewport) {
          await next.focus();
          await expect(next).toBeFocused();
          await expect
            .poll(() =>
              next.evaluate((element) => {
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
          path: testInfo.outputPath(
            `historical-evidence-${language}-${width}.png`
          ),
          fullPage: false,
          animations: 'disabled'
        });
        await next.click();
        await expect(first).toHaveCount(1);
        await expect(first).toContainText('LinkedIn');
        await expect(first).toContainText('OpenG20');
        await expect(first).not.toContainText(evidenceId);
        await expect(
          panel.locator('[data-og7-id="historical-audit-next"]')
        ).toHaveCount(0);
        expect(
          new URL(state.queries.at(-1)!).searchParams.get('contributionId')
        ).toBe(item.contributionId);
        expect(new URL(state.queries.at(-1)!).searchParams.get('cursor')).toBe(
          'synthetic-next-cursor'
        );
        expect(state.commands).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
      });
    }
  }
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
      ).toContainText('55');
      expect(
        new URL(state.queries[0]!).searchParams.get('contributionId')
      ).toBe(item.contributionId);
      await expect(panel.getByRole('checkbox')).toHaveCount(0);
      await expect(
        panel.locator('[data-og7-id="historical-audit-counts"]')
      ).not.toContainText('155');
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
