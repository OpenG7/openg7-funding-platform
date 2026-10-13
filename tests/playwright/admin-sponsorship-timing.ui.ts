import type { Page } from '@playwright/test';
import type {
  SponsorshipCommitmentRecord,
  SponsorshipPublicObservation,
  SponsorshipTimingCommandRequest
} from '@openg7/funding-core';
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';
interface Context {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<unknown>;
  path(tab?: string, value?: string): string;
}
const id = '10000000-0000-4000-8000-000000000401',
  obId = '10000000-0000-4000-8000-000000000904';
async function fixtures(page: Page, context: Context) {
  await context.fixtures(page, 'owner');
  const state: {
    commands: SponsorshipTimingCommandRequest[];
    lost: boolean;
    early: boolean;
    restart: boolean;
    publicObservation: SponsorshipPublicObservation | null;
  } = {
    commands: [],
    lost: false,
    early: false,
    restart: false,
    publicObservation: null
  };
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
  await page.route('**/admin/sponsorship-commitments**', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.endsWith('/sponsorship-commitments') &&
      route.request().method() === 'GET'
    ) {
      m = {
        ...m,
        obligations: m.obligations.map((o) => ({
          ...o,
          timing: {
            ...o.timing!,
            latestPublicObservation: state.publicObservation
          }
        }))
      };
      if (state.restart)
        m = {
          ...m,
          obligations: m.obligations.map((o) => ({
            ...o,
            timing: { ...o.timing!, durationState: 'restart_required' }
          }))
        };
      return route.fulfill({ json: { commitment: m } });
    }
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
    if (payload.kind === 'observe') {
      timing.durationState = 'awaiting_review';
      state.restart = false;
      timing.startObservation = {
        id: '10000000-0000-4000-8000-000000000907',
        observedAt: '2026-10-12T00:00:00.000Z',
        earliestCompletionAt: '2026-11-11T00:00:00.000Z'
      };
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
    await route.fulfill({ json: { obligationId: obId, timing } });
  });
  return state;
}
async function openTimingDetails(page: Page) {
  const panel = page.locator('[data-og7="sponsorship-timing"]');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-og7="commitments-refresh"]')).toBeEnabled();
  const details = panel.locator('details');
  if (!(await details.evaluate((element) => element.hasAttribute('open'))))
    await panel.locator('summary').click();
  return panel;
}
async function statement(page: Page) {
  const panel = await openTimingDetails(page);
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
  ] as const) {
    test(`sponsorship timing public HTTP samples remain dated information requiring human continuity in ${locale} at ${width}px`, async ({
      page
    }) => {
      const state = await fixtures(page, context);
      state.publicObservation = {
        checkedAt: '2026-10-12T00:00:00.000Z',
        status: locale === 'en' ? 'unknown' : 'visible',
        reason: locale === 'en' ? 'HTTP_TIMEOUT' : 'MATCH',
        httpStatus: locale === 'en' ? null : 200
      };
      await page.setViewportSize({ width, height: 900 });
      await page.goto(context.path('publication'));
      if (locale === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const panel = await openTimingDetails(page);
      await expect(
        panel.locator('[data-og7="timing-public-observation"]')
      ).toContainText(locale === 'en' ? 'Oct 12, 2026' : '12 oct. 2026');
      await expect(
        panel.locator('[data-og7="timing-public-observation"]')
      ).toContainText(
        locale === 'en'
          ? 'Completion still requires your attestation'
          : 'La clôture exige toujours votre attestation'
      );
      if (locale === 'en')
        await expect(
          panel.locator('[data-og7="timing-public-incident"]')
        ).toContainText('time limit');
      else
        await expect(
          panel.locator('[data-og7="timing-public-incident"]')
        ).toHaveCount(0);
      expect(state.commands).toHaveLength(0);
      await expect(
        panel.locator('[data-og7="timing-attest-duration"]')
      ).toBeVisible();
      await expect(
        panel.locator('[data-og7="timing-continuity"]')
      ).not.toBeChecked();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="sponsorship-timing"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
    test(`sponsorship timing known interruption requires a fresh owner observation in ${locale} at ${width}px`, async ({
      page
    }) => {
      const state = await fixtures(page, context);
      state.restart = true;
      state.publicObservation = {
        checkedAt: '2026-10-12T00:00:00.000Z',
        status: 'not_visible',
        reason: 'PUBLIC_MEDIA_MISSING',
        httpStatus: 404
      };
      await page.setViewportSize({ width, height: 900 });
      await page.goto(context.path('publication'));
      if (locale === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const panel = await statement(page);
      await expect(
        panel.locator('[data-og7="timing-restart-required"]')
      ).toBeVisible();
      await expect(
        panel.locator('[data-og7="timing-attest-duration"]')
      ).toHaveCount(0);
      expect(state.commands).toHaveLength(0);
      const observe = panel.locator('[data-og7="timing-observe"]');
      await observe.focus();
      await expect(observe).toBeFocused();
      await observe.press('Enter');
      await expect(
        panel.locator('[data-og7="timing-restart-required"]')
      ).toHaveCount(0);
      await expect(panel.locator('dl')).toContainText(
        locale === 'fr-CA' ? '12 oct. 2026' : 'Oct 12, 2026'
      );
      await openTimingDetails(page);
      await expect(
        panel.locator('[data-og7="timing-attest-duration"]')
      ).toBeVisible();
      expect(state.commands).toHaveLength(1);
      expect(state.commands[0]).toMatchObject({
        kind: 'observe',
        confirmation: obId,
        expectedVersion: 1
      });
      expect(state.commands[0].continuityConfirmed).toBeUndefined();
      await expect(panel).not.toContainText(
        'admin.timing.states.restart_required'
      );
      const issues = await new AxeBuilder({ page })
        .include('[data-og7="sponsorship-timing"]')
        .analyze();
      expect(issues.violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
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
      await expect(panel.locator('dl')).toContainText(
        locale === 'fr-CA' ? '8 janv. 2026' : 'Jan 8, 2026'
      );
      await openTimingDetails(page);
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
