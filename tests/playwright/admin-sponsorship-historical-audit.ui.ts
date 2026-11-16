import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  SponsorshipHistoricalAuditItem,
  SponsorshipHistoricalAuditReviewRequest
} from '@openg7/funding-core';

import { openPublicationSection } from './support/sponsorship-dossier.js';
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
async function fixtures(
  page: Page,
  context: Context,
  role?: 'owner' | 'operator' | 'reader'
) {
  await context.fixtures(page, role);
  const state = {
    failure: 0,
    readFailure: 0,
    reviewGate: null as Promise<void> | null,
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
        if (state.readFailure)
          return route.fulfill({
            status: state.readFailure,
            json: { code: 'HISTORICAL_AUDIT_UNAVAILABLE' }
          });
        const cursor =
          new URL(route.request().url()).searchParams.get('cursor') ?? '';
        const entries = state.pages[cursor] ?? [item];
        return route.fulfill({
          json: {
            items: entries.map((entry) => ({
              ...entry,
              reviewVersion: state.version
            })),
            pageSize: 25,
            nextCursor:
              cursor || !entries.length ? null : 'synthetic-next-cursor',
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
      if (state.reviewGate) await state.reviewGate;
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
    for (const width of [1920, 1536, 390, 1280, 768]) {
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
          },
          {
            ...item,
            evidenceId: '10000000-0000-4000-8000-000000000607',
            obligationId: '10000000-0000-4000-8000-000000000608',
            benefitId: 'facebook_batch',
            channel: 'facebook',
            durationDays: null,
            requirements: [
              { element: 'company_name', observation: 'satisfied' },
              { element: 'approved_presentation', observation: 'unknown' },
              { element: 'approved_logo', observation: 'missing' }
            ],
            findings: ['required_element_missing', 'snapshot_incomplete']
          },
          {
            ...item,
            evidenceId: '10000000-0000-4000-8000-000000000609',
            obligationId: '10000000-0000-4000-8000-000000000610',
            benefitId: 'linkedin_batch',
            channel: 'linkedin',
            target: 'openg20',
            durationDays: null,
            requirements: [
              { element: 'company_name', observation: 'satisfied' }
            ],
            findings: [],
            latestReview: {
              id: '10000000-0000-4000-8000-000000000611',
              conclusion: 'confirmed',
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
        await openPublicationSection(page, 'contract');
        const panel = page.locator('[data-og7="historical-evidence-audit"]');
        const help = panel.locator('[data-og7="historical-audit-help"]');
        await expect(help).not.toHaveAttribute('open');
        await help.locator(':scope > summary').focus();
        await page.keyboard.press('Enter');
        await expect(help).toHaveAttribute('open', '');
        expect(state.queries).toEqual([]);
        await panel.locator('[data-og7-id="historical-audit-load"]').click();
        await expect(
          panel.locator('[data-og7="historical-audit-as-of"] time')
        ).toHaveAttribute('datetime', '2026-10-12T00:00:00.000Z');
        await expect(
          panel.locator('[data-og7="historical-audit-as-of"]')
        ).toContainText('Toronto');
        await expect(
          panel.locator('[data-og7="historical-audit-page-summary"]')
        ).toContainText('3');
        await expect(help).toContainText('25');
        await expect(
          panel.locator('[data-og7-id="historical-audit-counts"]')
        ).toContainText('55');
        const rows = panel.locator('[data-og7-id="historical-audit-item"]');
        const table = panel.locator('[data-og7="historical-audit-table"]');
        await expect(table.getByRole('columnheader')).toHaveCount(5);
        for (const header of await table.getByRole('columnheader').all()) {
          await expect(header).toHaveAttribute('scope', 'col');
          await expect(header).not.toHaveAccessibleName('');
        }
        await help.locator(':scope > summary').click();
        await expect(help).not.toHaveAttribute('open');
        await expect(rows).toHaveCount(3);
        const first = rows.first();
        await expect(first).toContainText(
          language === 'en' ? 'Website' : 'Site Web'
        );
        await expect(
          first.locator('[data-og7="historical-audit-evidence-date"]')
        ).toHaveAttribute('datetime', item.deliveredAt);
        await expect(
          first.locator('[data-og7="historical-audit-evidence-date"]')
        ).toContainText(language === 'en' ? 'Sep 30, 2026' : '30 sept. 2026');
        await expect(
          first.locator('[data-og7="historical-audit-review-date"]')
        ).toContainText(language === 'en' ? 'Oct 4, 2026' : '4 oct. 2026');
        await expect(
          first.locator('[data-og7="historical-audit-latest-review"]')
        ).toContainText(
          language === 'en' ? 'Inconclusive' : 'Conclusion indéterminée'
        );
        const firstReview = first.locator(
          '[data-og7-id="historical-audit-review"]'
        );
        await firstReview.focus();
        await page.keyboard.press('Enter');
        const examination = panel.locator(
          '[data-og7="historical-audit-review-panel"]'
        );
        await expect(examination).toBeFocused();
        await expect(first).toHaveAttribute('data-selected', 'true');
        const observations = examination.locator(
          '[data-og7="historical-audit-observations"]'
        );
        await expect(observations).not.toHaveAttribute('open');
        const durationFinding = first.locator(
          '[data-og7="historical-audit-finding"][data-og7-id="duration_unverified"]'
        );
        await expect(durationFinding).toHaveText(
          language === 'en' ? 'Duration to verify' : 'Durée à vérifier'
        );
        await expect(durationFinding).toHaveAccessibleName(
          language === 'en'
            ? 'Promised duration has no matching verified continuity record.'
            : 'La durée promise n’a pas de relevé de continuité vérifié correspondant.'
        );
        await expect(
          observations.getByText(
            language === 'en'
              ? 'Promised duration has no matching verified continuity record.'
              : 'La durée promise n’a pas de relevé de continuité vérifié correspondant.',
            { exact: true }
          )
        ).toBeHidden();
        const social = rows.nth(1);
        await expect(social).toContainText('Facebook');
        const socialReview = social.locator(
          '[data-og7-id="historical-audit-review"]'
        );
        await socialReview.click();
        await expect(examination).toBeFocused();
        await expect(social).toHaveAttribute('data-selected', 'true');
        await expect(first).toHaveAttribute('data-selected', 'false');
        for (const [element, observation, short, full] of [
          [
            'company_name',
            'satisfied',
            language === 'en' ? 'Recorded' : 'Enregistré',
            language === 'en'
              ? /Company name.*Recorded/
              : /Nom de l’entreprise.*Enregistré/
          ],
          [
            'approved_presentation',
            'unknown',
            language === 'en' ? 'Unknown' : 'Inconnu',
            language === 'en'
              ? /Approved presentation.*Unknown/
              : /Présentation approuvée.*Inconnu/
          ],
          [
            'approved_logo',
            'missing',
            'Absent',
            language === 'en'
              ? /Approved logo.*Absent/
              : /Logo approuvé.*Absent/
          ]
        ] as const) {
          const chip = examination.locator(
            `[data-og7="historical-audit-requirement"][data-og7-id="${element}"]`
          );
          await expect(chip).toHaveAttribute('data-observation', observation);
          await expect(chip).toContainText(short);
          await expect(chip).toHaveAccessibleName(full);
          await expect(chip).toHaveAttribute('title', full);
        }
        await examination
          .locator('[data-og7="historical-audit-cancel"]')
          .click();
        await expect(examination).toHaveCount(0);
        await expect(socialReview).toBeFocused();
        const reviewed = rows.nth(2);
        const noIssue = reviewed.locator(
          '[data-og7="historical-audit-finding"][data-og7-id="no_issue_detected"]'
        );
        await expect(noIssue).toHaveText(
          language === 'en' ? 'No issue detected' : 'Aucun problème détecté'
        );
        await expect(noIssue).toHaveAccessibleName(
          language === 'en'
            ? 'No issue detected in the recorded facts.'
            : 'Aucun problème détecté parmi les faits enregistrés.'
        );
        await expect(
          reviewed.locator('[data-og7="historical-audit-latest-review"]')
        ).toContainText(
          language === 'en'
            ? 'Agreement reviewed and confirmed'
            : 'Accord examiné et confirmé'
        );
        await firstReview.click();
        await expect(examination).toBeFocused();
        if (width === 1920 || width === 390) {
          const tableBox = await table.boundingBox();
          const panelBox = await examination.boundingBox();
          expect(tableBox).not.toBeNull();
          expect(panelBox).not.toBeNull();
          if (width === 1920)
            expect(panelBox!.x).toBeGreaterThanOrEqual(
              tableBox!.x + tableBox!.width - 1
            );
          else
            expect(panelBox!.y).toBeGreaterThanOrEqual(
              tableBox!.y + tableBox!.height - 1
            );
        }
        if (
          (language === 'fr-CA' && width === 1920) ||
          (language === 'en' && width === 390)
        ) {
          await panel.screenshot({
            path: testInfo.outputPath('audit-workspace.png')
          });
        }
        const observationsToggle = observations.locator(':scope > summary');
        await expect(observationsToggle).toHaveText(
          language === 'en'
            ? 'Detailed observations'
            : 'Observations détaillées'
        );
        await observationsToggle.focus();
        await page.keyboard.press('Enter');
        await expect(observations).toHaveAttribute('open', '');
        await expect(observations).toContainText(
          language === 'en'
            ? 'A required element is absent from the recorded display.'
            : 'Un élément requis est absent de l’affichage enregistré.'
        );
        await page.keyboard.press('Enter');
        await expect(observations).not.toHaveAttribute('open');
        await expect(observationsToggle).toBeFocused();
        const references = examination.locator(
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
        await expect(
          first.locator('[data-og7="historical-audit-open-evidence"]')
        ).toHaveAccessibleName(
          language === 'en'
            ? /^View.*View this service and its evidence$/
            : /^Voir.*Consulter cette prestation et sa preuve$/
        );
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="historical-evidence-audit"]')
              .analyze()
          ).violations
        ).toEqual([]);
        await examination
          .locator('[data-og7="historical-audit-close"]')
          .click();
        await expect(examination).toHaveCount(0);
        await expect(firstReview).toBeFocused();
        expect(state.queries).toHaveLength(1);
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
        await expect(rows).toHaveCount(1);
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
      await openPublicationSection(page, 'contract');
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
        panel.locator('[data-og7="historical-audit-open-evidence"]')
      ).toHaveAttribute(
        'href',
        `/admin/fundraiser/campaigns?sponsorshipId=${item.contributionId}&obligationId=${item.obligationId}`
      );
      await panel.locator('[data-og7-id="historical-audit-next"]').click();
      await expect.poll(() => state.queries.length).toBe(2);
      expect(new URL(state.queries[1]!).searchParams.get('cursor')).toBe(
        'synthetic-next-cursor'
      );
      const examine = panel.locator('[data-og7-id="historical-audit-review"]');
      await examine.click();
      const examination = panel.locator(
        '[data-og7="historical-audit-review-panel"]'
      );
      await expect(examination).toBeFocused();
      const form = examination.locator('form');
      await expect(panel.locator('form')).toHaveCount(1);
      await expect(
        form.locator('[data-og7-id="historical-audit-save"]')
      ).toBeDisabled();
      await form
        .locator('textarea')
        .fill('Synthetic private historical examination');
      await form.locator('select').selectOption('confirmed');
      await form.locator('input[type="checkbox"]').check();
      await examine.click();
      await expect(form.locator('textarea')).toHaveValue(
        'Synthetic private historical examination'
      );
      await expect(form.locator('select')).toHaveValue('confirmed');
      await expect(form.locator('input[type="checkbox"]')).toBeChecked();
      expect(state.commands).toEqual([]);
      await examination.locator('[data-og7="historical-audit-cancel"]').click();
      await expect(examination).toHaveCount(0);
      await expect(examine).toBeFocused();
      await examine.press('Enter');
      await expect(form.locator('textarea')).toHaveValue('');
      await expect(form.locator('select')).toHaveValue('inconclusive');
      await expect(form.locator('input[type="checkbox"]')).not.toBeChecked();
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
    await openPublicationSection(page, 'contract');
    const panel = page.locator('[data-og7="historical-evidence-audit"]');
    await panel.locator('[data-og7-id="historical-audit-load"]').click();
    await panel.locator('[data-og7-id="historical-audit-review"]').click();
    const examination = panel.locator(
      '[data-og7="historical-audit-review-panel"]'
    );
    await examination.locator('textarea').fill('Synthetic exact command');
    await examination.locator('form input[type="checkbox"]').check();
    state.failure = 503;
    let release!: () => void;
    state.reviewGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await examination.locator('[data-og7-id="historical-audit-save"]').click();
    await expect.poll(() => state.commands.length).toBe(1);
    const close = examination.locator('[data-og7="historical-audit-close"]');
    const cancel = examination.locator('[data-og7="historical-audit-cancel"]');
    const terms = page.locator('[data-og7="publication-terms"]');
    try {
      await expect(close).toBeDisabled();
      await expect(cancel).toBeDisabled();
      await terms.locator('[data-og7="publication-terms-toggle"]').focus();
      await page.keyboard.press('Enter');
      await expect(terms).toHaveAttribute('open', '');
    } finally {
      state.reviewGate = null;
      release();
    }
    await expect(
      panel.locator('[data-og7-id="historical-audit-retry"]')
    ).toBeVisible();
    const original = structuredClone(state.commands[0]);
    await expect(close).toBeDisabled();
    await expect(cancel).toBeDisabled();
    const captured = examination.locator(
      '[data-og7="historical-audit-pending-command"]'
    );
    await captured.locator(':scope > summary').press('Enter');
    await expect(captured).toHaveAttribute('open', '');
    await expect(captured).toContainText(original!.requestId);
    await expect(captured).toContainText(original!.reason);
    await expect(captured.locator('dd').filter({ hasText: /^0$/ })).toHaveCount(
      1
    );
    const observations = examination.locator(
      '[data-og7="historical-audit-observations"]'
    );
    await observations.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(observations).toHaveAttribute('open', '');
    await expect(observations).toContainText(
      'La durée promise n’a pas de relevé de continuité vérifié correspondant.'
    );
    await page.keyboard.press('Enter');
    await expect(observations).not.toHaveAttribute('open');
    await expect(
      panel.locator('[data-og7-id="historical-audit-retry"]')
    ).toBeVisible();
    expect(state.commands).toHaveLength(1);
    await panel.locator('[data-og7-id="historical-audit-load"]').click();
    await expect.poll(() => state.queries.length).toBe(2);
    await expect(examination).toBeVisible();
    await expect(examination.locator('textarea')).toHaveValue(
      'Synthetic exact command'
    );
    await expect(close).toBeDisabled();
    await terms.locator('[data-og7="publication-terms-toggle"]').focus();
    await page.keyboard.press('Enter');
    await expect(terms).toHaveAttribute('open', '');
    state.failure = 409;
    await panel.locator('[data-og7-id="historical-audit-retry"]').click();
    await expect(
      panel.locator('[data-og7-id="historical-audit-retry"]')
    ).toHaveCount(0);
    expect(state.commands[1]).toEqual(original);
    await expect(examination).toHaveCount(0);
    await expect(
      panel.locator('[data-og7-id="historical-audit-review"]')
    ).toBeFocused();
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

  for (const replacement of ['session', 'dossier'] as const) {
    test(`historical audit clears its private review context after a ${replacement} change`, async ({
      page
    }) => {
      const state = await fixtures(page, context, 'owner');
      let sessionId = 'synthetic-original-audit-session';
      let identityReads = 0;
      await page.route('**/api/admin/auth/current', async (route) => {
        identityReads++;
        await route.fulfill({
          json: {
            id: 'synthetic-audit-owner',
            sessionId,
            displayName: 'Synthetic audit owner',
            role: 'owner',
            expiresAt: '2099-01-01T00:00:00Z'
          }
        });
      });
      await page.setViewportSize({ width: 1536, height: 900 });
      await page.goto(context.path('publication'));
      await openPublicationSection(page, 'contract');
      const audit = page.locator('[data-og7="historical-evidence-audit"]');
      await audit.locator('[data-og7-id="historical-audit-load"]').click();
      await audit.locator('[data-og7-id="historical-audit-review"]').click();
      const examination = audit.locator(
        '[data-og7="historical-audit-review-panel"]'
      );
      await examination
        .locator('textarea')
        .fill('Synthetic private audit draft');
      if (replacement === 'session') {
        sessionId = 'synthetic-replacement-audit-session';
        const reads = identityReads;
        await page
          .locator('[data-og7="dossier-tabs"]')
          .getByRole('button', { name: 'Identité', exact: true })
          .click();
        await expect.poll(() => identityReads).toBeGreaterThan(reads);
      } else {
        await page
          .locator('[data-og7="sponsors-list"]')
          .getByRole('searchbox')
          .fill('');
        const tools = page.locator('[data-og7="dossier-global-tools"]');
        if ((await tools.getAttribute('open')) === null)
          await tools.locator(':scope > summary').click();
        await page
          .getByRole('button', { name: 'Dossier suivant', exact: true })
          .click();
        await expect(page).toHaveURL(
          context.path('publication', '10000000-0000-4000-8000-000000000402')
        );
      }
      await expect(examination).toHaveCount(0);
      await openPublicationSection(page, 'contract');
      await expect(
        audit.locator('[data-og7="historical-audit-review-panel"]')
      ).toHaveCount(0);
      await expect(
        audit.locator('[data-og7-id="historical-audit-item"]')
      ).toHaveCount(0);
      await expect(audit).not.toContainText('Synthetic private audit draft');
      expect(state.queries).toHaveLength(1);
      expect(state.commands).toEqual([]);
    });
  }

  test('historical audit exposes a failed read and an empty result before recovering without a review', async ({
    page
  }) => {
    const state = await fixtures(page, context);
    state.readFailure = 503;
    await page.goto(context.path('publication'));
    await openPublicationSection(page, 'contract');
    const audit = page.locator('[data-og7="historical-evidence-audit"]');
    await audit.locator('[data-og7-id="historical-audit-load"]').click();
    await expect(audit.getByRole('alert')).toBeVisible();
    await expect(
      audit.locator('[data-og7="historical-audit-review-panel"]')
    ).toHaveCount(0);
    state.readFailure = 0;
    state.pages[''] = [];
    await audit.locator('[data-og7-id="historical-audit-load"]').click();
    await expect(audit.getByRole('alert')).toHaveCount(0);
    await expect(audit).toContainText(
      'Aucune preuve historique ne correspond à ces filtres.'
    );
    await expect(
      audit.locator('[data-og7-id="historical-audit-item"]')
    ).toHaveCount(0);
    state.pages[''] = [item];
    await audit.locator('[data-og7-id="historical-audit-load"]').click();
    await expect(
      audit.locator('[data-og7-id="historical-audit-item"]')
    ).toHaveCount(1);
    await expect(
      audit.locator('[data-og7="historical-audit-review-panel"]')
    ).toHaveCount(0);
    expect(state.queries).toHaveLength(3);
    expect(state.commands).toEqual([]);
  });

  for (const role of ['operator', 'reader'] as const) {
    test(`historical audit exposes no owner read or review controls to ${role}`, async ({
      page
    }) => {
      const state = await fixtures(page, context, role);
      await page.goto(context.path('publication'));
      await openPublicationSection(page, 'contract');
      const audit = page.locator('[data-og7="historical-evidence-audit"]');
      await expect(audit).toHaveCount(0);
      await expect(
        audit.locator('[data-og7-id="historical-audit-load"]')
      ).toHaveCount(0);
      await expect(
        audit.locator('[data-og7="historical-audit-review-panel"]')
      ).toHaveCount(0);
      expect(state.queries).toEqual([]);
      expect(state.commands).toEqual([]);
    });
  }
}
