import type { Page } from '@playwright/test';
import type {
  AdminSponsorshipRecord,
  AdminSponsorshipProgress,
  SponsorshipCommitmentRecord,
  SponsorshipTimingCommandRequest
} from '@openg7/funding-core';
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';
interface Context {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<{
    options: {
      edited: Map<string, Partial<AdminSponsorshipRecord>>;
      progressOverrides: Partial<AdminSponsorshipProgress>;
    };
  }>;
  path(tab?: string, value?: string): string;
}
const id = '10000000-0000-4000-8000-000000000401',
  obId = '10000000-0000-4000-8000-000000000904';
async function fixtures(page: Page, context: Context) {
  const base = await context.fixtures(page, 'owner');
  const state: {
    commands: SponsorshipTimingCommandRequest[];
    lost: boolean;
    early: boolean;
  } = { commands: [], lost: false, early: false };
  let m: SponsorshipCommitmentRecord = {
    id: '10000000-0000-4000-8000-000000000900',
    contributionId: id,
    offerId: '10000000-0000-4000-8000-000000000905',
    provenance: 'qualified_historical',
    state: 'active',
    qualificationReason: null,
    version: 2,
    offer: {
      version: 'historical-qualification-v1',
      amountMinor: 50000,
      currency: 'CAD',
      benefits: [
        {
          id: 'website_mention',
          channel: 'website',
          target: 'openg7',
          quantity: 1,
          requiredElements: ['company_name', 'approved_presentation'],
          deadlineDays: 7,
          durationDays: 30
        }
      ]
    },
    obligations: [
      {
        id: obId,
        commitmentId: '10000000-0000-4000-8000-000000000900',
        contributionId: id,
        benefitId: 'website_mention',
        channel: 'website',
        target: 'openg7',
        ordinal: 1,
        state: 'pending',
        blockedReason: null,
        version: 1,
        fulfilmentEvidenceId: null,
        timing: {
          version: 1,
          deadlineDays: 7,
          durationDays: 30,
          originAt: null,
          originProvenance: null,
          dueAt: null,
          overdue: false,
          durationState: 'awaiting_review',
          startObservation: {
            id: '10000000-0000-4000-8000-000000000906',
            observedAt: '2026-01-01T00:00:00.000Z',
            earliestCompletionAt: '2026-01-31T00:00:00.000Z'
          }
        }
      }
    ]
  };
  const sync = () => {
    base.options.progressOverrides = {
      ...base.options.progressOverrides,
      commitment: m
    };
    base.options.edited.set(id, {
      ...base.options.edited.get(id),
      commitment: m
    });
  };
  sync();
  await page.route('**/admin/sponsorship-commitments**', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.endsWith('/sponsorship-commitments') &&
      route.request().method() === 'GET'
    )
      return route.fulfill({ json: { commitment: m } });
    if (!url.pathname.endsWith('/sponsorship-commitments/timing'))
      return route.fallback();
    const payload = route
      .request()
      .postDataJSON() as SponsorshipTimingCommandRequest;
    state.commands.push(payload);
    if (state.lost) {
      state.lost = false;
      return route.abort('failed');
    }
    if (state.early)
      return route.fulfill({
        status: 409,
        json: { code: 'DURATION_NOT_ELAPSED' }
      });
    const o = m.obligations[0]!,
      timing = { ...o.timing!, version: payload.expectedVersion + 1 };
    if (payload.kind === 'origin') {
      timing.originAt = payload.originAt!;
      timing.originProvenance = 'owner_recorded';
      timing.dueAt = '2026-01-08T00:00:00.000Z';
      timing.overdue = true;
    }
    if (payload.kind === 'duration') {
      timing.durationState = 'attested';
      timing.overdue = false;
    }
    m = {
      ...m,
      obligations: [
        {
          ...o,
          timing,
          ...(payload.kind === 'duration' ? { state: 'fulfilled' } : {})
        }
      ]
    };
    sync();
    await route.fulfill({ json: { obligationId: obId, timing } });
  });
  return state;
}
async function statement(page: Page) {
  const panel = page.locator('[data-og7="sponsorship-timing"]');
  if (
    !(await panel
      .locator('details')
      .evaluate((details) => details.hasAttribute('open')))
  )
    await panel.locator('summary').click();
  await panel
    .locator('[data-og7="timing-reason"]')
    .fill('Synthetic supported owner statement');
  await panel
    .locator('[data-og7="timing-evidence"]')
    .fill('synthetic://exposure-proof');
  await panel.locator('[data-og7="timing-confirmation"]').fill(obId);
  return panel;
}
export function registerSponsorshipTimingTests(context: Context): void {
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const)
    test(`sponsorship timing explicit owner origin and justified duration in ${locale} at ${width}px`, async ({
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
      const panel = await statement(page);
      await panel
        .locator('[data-og7="timing-origin"]')
        .fill('2026-01-01T00:00');
      await panel.locator('[data-og7="timing-record-origin"]').click();
      await expect(panel.locator('[data-og7="timing-overdue"]')).toBeVisible();
      expect(state.commands[0]).toMatchObject({
        kind: 'origin',
        originAt: '2026-01-01T00:00:00.000Z',
        confirmation: obId,
        expectedVersion: 1
      });
      const origin = panel.locator('[data-og7="timing-origin"]');
      await expect(origin).toHaveCount(0);
      await statement(page);
      await panel
        .locator('[data-og7="timing-reason"]')
        .fill('Synthetic verified continuity statement');
      await panel
        .locator('[data-og7="timing-evidence"]')
        .fill('synthetic://duration-proof');
      await panel.locator('[data-og7="timing-confirmation"]').fill(obId);
      await panel.locator('[data-og7="timing-attest-duration"]').click();
      expect(state.commands).toHaveLength(1);
      await panel.locator('[data-og7="timing-continuity"]').check();
      await panel.locator('[data-og7="timing-attest-duration"]').focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => state.commands.length).toBe(2);
      expect(state.commands[1]).toMatchObject({
        kind: 'duration',
        continuityConfirmed: true,
        expectedVersion: 2
      });
      await expect(panel.locator('fieldset')).toHaveCount(0);
      const issues = await new AxeBuilder({ page })
        .include('[data-og7="sponsorship-timing"]')
        .analyze();
      expect(issues.violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
    });
  test('sponsorship timing uncertain command retries the same UUID and early completion remains open', async ({
    page
  }) => {
    const state = await fixtures(page, context);
    state.lost = true;
    await page.goto(context.path('publication'));
    const panel = await statement(page);
    await panel.locator('[data-og7="timing-continuity"]').check();
    await panel.locator('[data-og7="timing-attest-duration"]').click();
    await expect(panel.locator('[data-og7="timing-retry"]')).toBeVisible();
    const first = state.commands[0];
    state.early = true;
    await panel.locator('[data-og7="timing-retry"]').click();
    await expect(panel.locator('[data-og7="timing-error"]')).toContainText(
      'durée minimale'
    );
    expect(state.commands[1]).toEqual(first);
    await expect(panel.locator('[data-og7="timing-retry"]')).toHaveCount(0);
    await expect(
      panel.locator('[data-og7="timing-attest-duration"]')
    ).toBeEnabled();
  });
}
