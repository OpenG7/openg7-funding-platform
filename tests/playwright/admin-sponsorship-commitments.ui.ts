import type { Page } from '@playwright/test';
import type {
  AdminSponsorshipRecord,
  AdminSponsorshipProgress,
  SponsorshipCommitmentRecord,
  SponsorshipOfferedBenefit,
  SponsorshipCommitmentQualificationRequest
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
const id = '10000000-0000-4000-8000-000000000401',
  obId = '10000000-0000-4000-8000-000000000451';
interface Context {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<{
    calls: readonly { method: string; url: URL }[];
    options: {
      edited: Map<string, Partial<AdminSponsorshipRecord>>;
      progressOverrides: Partial<AdminSponsorshipProgress>;
    };
  }>;
  path(tab?: string, value?: string): string;
}
async function commercialFixtures(
  page: Page,
  context: Context,
  role: 'owner' | 'operator' | 'reader' = 'owner'
) {
  const base = await context.fixtures(page, role);
  let m: SponsorshipCommitmentRecord = {
    id: '10000000-0000-4000-8000-000000000450',
    contributionId: id,
    offerId: null,
    provenance: 'historical_unverified',
    state: 'needs_confirmation',
    qualificationReason: null,
    version: 1,
    offer: null,
    obligations: []
  };
  const state = {
    failure: false,
    commands: [] as unknown[],
    previews: [] as string[]
  };
  await page.route('**/api/admin/sponsorship-commitments**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname.endsWith('/adoption-preview')) {
      state.previews.push(url.search);
      return route.fulfill({
        json: {
          pageSize: Number(url.searchParams.get('pageSize')),
          nextCursor: null,
          items: [
            {
              contributionId: id,
              reference: 'SYNTHETIC-AGREEMENT',
              classification: 'unqualified',
              obligationCount: 0,
              fulfilledWithEvidenceCount: 0,
              historicalDeclarationCount: 3
            }
          ]
        }
      });
    }
    if (req.method() === 'POST') {
      const payload = req.postDataJSON();
      state.commands.push(payload);
      if (state.failure)
        return route.fulfill({
          status: 503,
          json: { code: 'COMMITMENT_UNAVAILABLE' }
        });
      if (url.pathname.endsWith('/qualify'))
        m = {
          ...m,
          state: 'active',
          version: 2,
          offerId: '10000000-0000-4000-8000-000000000452',
          provenance: 'qualified_historical',
          offer: payload.offer,
          obligations: payload.offer.benefits.flatMap(
            (b: SponsorshipOfferedBenefit) =>
              Array.from({ length: b.quantity }, (_, i) => ({
                id: i === 0 ? obId : '10000000-0000-4000-8000-000000000453',
                commitmentId: m.id,
                contributionId: id,
                benefitId: b.id,
                channel: b.channel,
                target: b.target,
                ordinal: i + 1,
                state: 'pending',
                format: b.format ?? null,
                version: 1,
                blockedReason: null,
                fulfilmentEvidenceId: null
              }))
          )
        };
      else
        m = {
          ...m,
          version: m.version + 1,
          obligations: m.obligations.map((o) =>
            o.id === payload.obligationId
              ? {
                  ...o,
                  target: payload.target ?? o.target,
                  format: payload.format ?? o.format,
                  state: payload.kind === 'waiver' ? 'adjusted' : o.state,
                  version: o.version + 1
                }
              : o
          )
        };
      base.options.progressOverrides = {
        ...base.options.progressOverrides,
        commitment: m
      };
      base.options.edited.set(id, {
        ...base.options.edited.get(id),
        commitment: m
      });
    }
    return route.fulfill({ json: { commitment: m } });
  });
  return { state, base };
}
async function fill(page: Page) {
  const panel = page.locator('[data-og7="admin-commitments"]');
  await panel.locator('[data-og7="commitments-add-benefit"]').click();
  await panel
    .locator('[data-og7="commitments-benefit-channel"]')
    .selectOption('facebook');
  await panel
    .locator('[data-og7="commitments-benefit-target"]')
    .selectOption('openg20');
  await panel.locator('[data-og7="commitments-benefit-quantity"]').fill('2');
  await panel.locator('[data-og7="commitments-company-required"]').check();
  await panel
    .locator('[data-og7="commitments-evidence"]')
    .fill('synthetic://agreement/qualified');
  await panel
    .locator('[data-og7="commitments-reason"]')
    .fill('Synthetic agreement independently verified');
  await panel.locator('[data-og7="commitments-confirmation"]').fill(id);
  return panel;
}
export function registerSponsorshipCommitmentTests(context: Context): void {
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    test(`recorded commitments owner qualifies explicit historical terms in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { state, base } = await commercialFixtures(page, context);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(context.path('publication'));
      if (locale === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const panel = page.locator('[data-og7="admin-commitments"]');
      await expect(page.locator('#publication-benefits')).toHaveCount(0);
      await expect(
        panel.getByRole('heading', {
          name: locale === 'en' ? 'Promised services' : 'Prestations promises',
          exact: true
        })
      ).toBeVisible();
      await expect(
        panel.locator('[data-og7="commitments-benefit-channel"]')
      ).toHaveCount(0);
      await fill(page);
      await panel.locator('[data-og7="commitments-deadline"]').fill('7');
      await panel.locator('[data-og7="commitments-duration"]').fill('30');
      await panel.locator('[data-og7="commitments-qualify"]').click();
      await expect(
        panel.getByText(
          locale === 'en'
            ? 'Duration unsupported: no terms recorded. Preserve the promised duration for sponsorship agreement review.'
            : 'Durée non prise en charge : aucun terme enregistré. Conservez la durée promise pour l’examen de l’accord de commandite.',
          { exact: true }
        )
      ).toBeVisible();
      expect(state.commands).toHaveLength(0);
      await expect(
        panel.locator('[data-og7="commitments-duration"]')
      ).toHaveValue('30');
      await panel.locator('[data-og7="commitments-duration"]').fill('');
      await panel.locator('[data-og7="commitments-qualify"]').click();
      await expect(
        panel.locator('[data-og7="commitments-accepted-offer"]')
      ).toBeVisible();
      expect(state.commands).toHaveLength(1);
      const payload = state
        .commands[0] as SponsorshipCommitmentQualificationRequest;
      expect(payload.confirmation).toBe(id);
      expect(payload.expectedVersion).toBe(1);
      expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(payload.offer).toEqual({
        version: 'historical-qualification-v1',
        amountMinor: 50000,
        currency: 'CAD',
        benefits: [
          {
            id: 'facebook_batch',
            channel: 'facebook',
            target: 'openg20',
            quantity: 2,
            requiredElements: ['company_name'],
            deadlineDays: 7,
            durationDays: null
          }
        ]
      });
      await expect(
        panel.locator('[data-og7="commitments-obligations"] > li')
      ).toHaveCount(2);
      expect(
        base.calls.filter(
          (c) =>
            c.method === 'POST' &&
            /refund|website-visibility|publication-automation|sponsorships\/review/.test(
              c.url.pathname
            )
        )
      ).toHaveLength(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
  test('recorded commitments retains an uncertain owner request and retries the same UUID and payload', async ({
    page
  }) => {
    const { state } = await commercialFixtures(page, context);
    state.failure = true;
    await page.goto(context.path('publication'));
    const panel = await fill(page);
    await panel.locator('[data-og7="commitments-qualify"]').click();
    await expect(panel.locator('[data-og7="commitments-error"]')).toBeVisible();
    await expect(
      panel.locator('[data-og7="commitments-reason"]')
    ).toBeDisabled();
    const original = structuredClone(state.commands[0]);
    state.failure = false;
    await panel.locator('[data-og7="commitments-retry"]').click();
    await expect(
      panel.locator('[data-og7="commitments-accepted-offer"]')
    ).toBeVisible();
    expect(state.commands).toHaveLength(2);
    expect(state.commands[1]).toEqual(original);
  });
  test('recorded commitments owner explicitly adjusts destination, format and waiver without rewriting accepted terms', async ({
    page
  }) => {
    const { state } = await commercialFixtures(page, context);
    await page.goto(context.path('publication'));
    const panel = await fill(page);
    await panel.locator('[data-og7="commitments-qualify"]').click();
    await expect(
      panel.locator('[data-og7="commitments-accepted-offer"]')
    ).toBeVisible();
    const original = structuredClone(
      (state.commands[0] as SponsorshipCommitmentQualificationRequest).offer
    );
    for (const [kind, field, value] of [
      ['destination', 'commitments-adjust-target', 'openg7'],
      ['format', 'commitments-adjust-format', 'individual_portrait'],
      ['waiver', 'commitments-waiver-confirm', '']
    ] as const) {
      const row = panel.locator(
        `[data-og7="commitments-obligations"] [data-og7-id="${obId}"]`
      );
      await row.locator('[data-og7="commitments-adjust-open"]').click();
      await panel
        .locator('[data-og7="commitments-adjust-kind"]')
        .selectOption(kind);
      if (kind === 'waiver')
        await panel.locator(`[data-og7="${field}"]`).check();
      else await panel.locator(`[data-og7="${field}"]`).selectOption(value);
      await panel
        .locator('[data-og7="commitments-adjust-reason"]')
        .fill('Synthetic explicit amendment');
      await panel
        .locator('[data-og7="commitments-adjust-confirmation"]')
        .fill(obId);
      await panel.locator('[data-og7="commitments-adjust-save"]').click();
      await expect(row).toContainText(`v${state.commands.length}`);
      if (kind === 'destination') await expect(row).toContainText('openg7');
      if (kind === 'format')
        await expect(row).toContainText('Portrait individuel');
    }
    expect(
      state.commands
        .slice(1)
        .map((input) => (input as { expectedVersion: number }).expectedVersion)
    ).toEqual([1, 2, 3]);
    expect(
      (state.commands[0] as SponsorshipCommitmentQualificationRequest).offer
    ).toEqual(original);
    await expect(
      panel.locator(
        `[data-og7="commitments-obligations"] [data-og7-id="${obId}"] [data-og7="commitments-adjust-open"]`
      )
    ).toHaveCount(0);
  });
  for (const role of ['operator', 'reader'] as const) {
    test(`recorded commitments exposes no owner mutation or adoption controls to ${role}`, async ({
      page
    }) => {
      const { state } = await commercialFixtures(page, context, role);
      await page.goto(context.path('publication'));
      const panel = page.locator('[data-og7="admin-commitments"]');
      await expect(panel).toBeVisible();
      await expect(
        panel.locator('[data-og7="commitments-qualification"]')
      ).toHaveCount(0);
      await expect(
        panel.locator('[data-og7="commitments-adoption"]')
      ).toHaveCount(0);
      expect(state.commands).toHaveLength(0);
      expect(state.previews).toHaveLength(0);
    });
  }
  test('recorded commitments owner adoption preview is bounded and does not qualify historical declarations', async ({
    page
  }) => {
    const { state } = await commercialFixtures(page, context);
    await page.goto(context.path('publication'));
    await expect(page.locator('[data-og7="commitments-adoption"]')).toHaveCount(
      0
    );
    await page.goto('/admin/fundraiser/sponsors/quality');
    const panel = page.locator('[data-og7="sponsors-quality-page"]');
    await panel.locator('[data-og7="commitments-adoption-load"]').click();
    await expect(
      panel.locator('[data-og7="commitments-adoption"]')
    ).toContainText('SYNTHETIC-AGREEMENT');
    expect(state.previews).toEqual(['?pageSize=25']);
    expect(state.commands).toHaveLength(0);
  });
}
