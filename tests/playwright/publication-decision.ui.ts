import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipRecord,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { completeModeration } from './support/moderation.js';
import { expect, test } from './support/test.js';

interface Context {
  fixtures(
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ): Promise<{
    calls: readonly {
      method: string;
      url: URL;
      body: Record<string, unknown> | null;
    }[];
    options: {
      edited: Map<string, Partial<AdminSponsorshipRecord>>;
      progressOverrides: Partial<AdminSponsorshipProgress>;
      reviewGate: Promise<void> | null;
      reviewStatus: number;
      reviewUpdated: boolean;
    };
  }>;
  path(tab?: string, value?: string): string;
  recordedCommitment(amountMinor: number): SponsorshipCommitmentRecord;
  id: string;
}

const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

/** Open the existing disclosure without toggling a panel already opened by context. */
export async function openPublicationAnalysis(page: Page): Promise<void> {
  const analysis = hook(page, 'publication-analysis');
  const toggle = hook(page, 'publication-analysis-toggle');
  await expect(toggle).toBeVisible();
  if ((await analysis.getAttribute('open')) === null) await toggle.click();
  await expect(analysis).toHaveAttribute('open', '');
}

export async function openOtherPublicationDecisions(page: Page): Promise<void> {
  const other = hook(page, 'publication-other-decisions');
  await expect(other).toBeVisible();
  if ((await other.getAttribute('open')) === null)
    await other.locator(':scope > summary').click();
  await expect(other).toHaveAttribute('open', '');
}

const writes = (calls: Awaited<ReturnType<Context['fixtures']>>['calls']) =>
  calls.filter((call) => call.method !== 'GET');
const reviews = (calls: Awaited<ReturnType<Context['fixtures']>>['calls']) =>
  calls.filter(
    (call) =>
      call.method === 'POST' &&
      call.url.pathname === '/api/admin/sponsorships/review'
  );

/** The Publication composition changes presentation, while existing decision ports stay authoritative. */
export function registerPublicationDecisionTests(context: Context): void {
  for (const language of ['fr-CA', 'en'] as const)
    for (const width of language === 'fr-CA'
      ? [1536, 390, 3840]
      : [1536, 390]) {
      test(`publication decision presents the four zones before diagnostics in ${language} at ${width}px`, async ({
        page
      }, info) => {
        const { calls, options } = await context.fixtures(page, 'operator');
        options.progressOverrides = {
          commitment: context.recordedCommitment(50000),
          publications: [],
          publicationCompletion: { done: 0, total: 3 }
        };
        await page.addInitScript(
          ({ locale, night }) => {
            localStorage.setItem('openg7.language', locale);
            if (night)
              localStorage.setItem(
                'openg7.pilotage.appearance.v1',
                JSON.stringify({ theme: 'night', system: false })
              );
          },
          { locale: language, night: width === 3840 }
        );
        await page.setViewportSize({
          width,
          height: width === 3840 ? 2160 : 1000
        });
        await page.goto(context.path('publication'));
        const monitor = hook(page, 'publication-monitor');
        const decision = hook(page, 'publication-decision');
        const analysis = hook(page, 'publication-analysis');
        await expect(
          monitor.getByRole('heading', { level: 2 }).first()
        ).toHaveText('Atelier Boréal');
        await expect(monitor).toContainText('DEMO-401');
        await expect(hook(page, 'publication-service')).toHaveCount(3);
        await expect(decision).toBeVisible();
        await expect(decision.getByRole('heading')).toHaveText(
          language === 'en'
            ? 'Human decision required'
            : 'Décision humaine attendue'
        );
        await expect(
          hook(page, 'dossier-actions').getByRole('button')
        ).toHaveCount(2);
        await expect(hook(page, 'sponsorship-approve')).toBeEnabled();
        await expect(analysis).not.toHaveAttribute('open', '');
        await expect(hook(page, 'publication-preparation-status')).toBeHidden();
        const order = await monitor.evaluate((element) => {
          const cards = element.querySelector(
            '[data-og7="publication-service"]'
          );
          const decision = element.querySelector(
            '[data-og7="publication-decision"]'
          );
          const analysis = element.querySelector(
            '[data-og7="publication-analysis"]'
          );
          return Boolean(
            cards &&
            decision &&
            analysis &&
            (cards.compareDocumentPosition(decision) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
              0 &&
            (decision.compareDocumentPosition(analysis) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
              0
          );
        });
        expect(order).toBe(true);
        await hook(page, 'publication-analysis-toggle').focus();
        await page.keyboard.press('Enter');
        await expect(analysis).toHaveAttribute('open', '');
        await openPublicationAnalysis(page);
        await expect(analysis).toHaveAttribute('open', '');
        await page.keyboard.press('Space');
        await expect(analysis).not.toHaveAttribute('open', '');
        await expect(hook(page, 'publication-analysis-toggle')).toBeFocused();
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="publication-monitor"]')
              .analyze()
          ).violations
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        expect(writes(calls)).toEqual([]);
        await monitor.screenshot({
          path: info.outputPath(`publication-decision-${language}-${width}.png`)
        });
      });
    }

  test('publication decision never records approval before its exact confirmed response', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'operator');
    let release = () => {};
    options.reviewGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    options.reviewStatus = 200;
    await page.goto(context.path('publication'));
    const approve = hook(page, 'sponsorship-approve');
    const decision = hook(page, 'publication-decision');
    await approve.click();
    await expect(hook(page, 'moderation-decision')).toBeVisible();
    expect(reviews(calls)).toEqual([]);
    await completeModeration(page);
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAttribute('aria-busy', 'true');
    await expect(decision).toContainText('Décision humaine attendue');
    await approve.evaluate((element: HTMLButtonElement) => {
      element.click();
      element.click();
    });
    expect(reviews(calls)).toHaveLength(1);
    expect(reviews(calls)[0]!.body).toMatchObject({
      contributionId: context.id,
      expectedVersion: 'v1',
      reviewStatus: 'approved',
      confirmation: context.id,
      moderationDecision: {
        contentVersion: 3,
        contentFingerprint: 'a'.repeat(64),
        level: 'N0',
        confirmation: context.id
      }
    });
    options.edited.set(context.id, {
      sponsor_review_status: 'approved',
      version: 'v2'
    });
    release();
    await expect(approve).toHaveCount(0);
    await expect(hook(page, 'publication-decision-status')).toHaveAttribute(
      'data-review-state',
      'approved'
    );
    expect(reviews(calls)).toHaveLength(1);
    expect(
      writes(calls).every(
        (call) =>
          !/publication-automation|website-visibility/.test(call.url.pathname)
      )
    ).toBe(true);
  });

  test('publication decision keeps a recorded approval separate from operational prerequisites', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'operator');
    options.edited.set(context.id, { sponsor_review_status: 'approved' });
    options.progressOverrides = {
      reviewStatus: 'approved',
      commitment: context.recordedCommitment(50000),
      publicationBlockers: ['media'],
      publications: [],
      publicationCompletion: { done: 0, total: 3 }
    };
    await page.goto(context.path('publication'));
    const decision = hook(page, 'publication-decision');
    await expect(hook(page, 'publication-decision-status')).toHaveAttribute(
      'data-review-state',
      'approved'
    );
    await expect(hook(page, 'sponsorship-approve')).toHaveCount(0);
    const other = hook(page, 'publication-other-decisions');
    await expect(other).not.toHaveAttribute('open', '');
    await openOtherPublicationDecisions(page);
    const reset = decision.getByRole('button', {
      name: 'Remettre en attente',
      exact: true
    });
    await reset.click();
    await expect(hook(page, 'confirm-action')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reset).toBeFocused();
    expect(writes(calls)).toEqual([]);
    await openPublicationAnalysis(page);
    await expect(
      hook(page, 'publication-delivery-progress').locator('progress')
    ).toHaveAttribute('value', '0');
  });

  test('publication decision shows the recorded refusal reason and contextual available decisions', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'operator');
    options.edited.set(context.id, {
      sponsor_review_status: 'rejected',
      sponsor_review_note: 'Motif interne synthétique autorisé'
    });
    options.progressOverrides = { reviewStatus: 'rejected' };
    await page.goto(context.path('publication'));
    const decision = hook(page, 'publication-decision');
    await expect(hook(page, 'publication-decision-status')).toHaveAttribute(
      'data-review-state',
      'rejected'
    );
    await expect(decision).toContainText('Motif interne synthétique autorisé');
    await expect(
      decision.getByRole('button', { name: 'Refuser', exact: true })
    ).toHaveCount(0);
    await openOtherPublicationDecisions(page);
    await expect(
      decision.getByRole('button', { name: 'Remettre en attente', exact: true })
    ).toBeEnabled();
    await expect(hook(page, 'sponsorship-approve')).toBeVisible();
    expect(writes(calls)).toEqual([]);
  });

  test('publication decision remains readable for a reader without mutation controls', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'reader');
    options.progressOverrides = {
      commitment: context.recordedCommitment(50000)
    };
    await page.goto(context.path('publication'));
    await expect(hook(page, 'publication-decision')).toBeVisible();
    await expect(hook(page, 'dossier-actions')).toHaveCount(0);
    await expect(hook(page, 'sponsorship-approve')).toHaveCount(0);
    await openPublicationAnalysis(page);
    await expect(
      hook(page, 'publication-preparation-engine-activate')
    ).toHaveCount(0);
    await expect(
      hook(page, 'publication-preparation-preflight-configure')
    ).toHaveCount(0);
    expect(writes(calls)).toEqual([]);
  });

  for (const blocked of [
    { payment_status: 'refunded' },
    { payment_status: 'disputed' },
    { sponsorship_refund_status: 'processing' }
  ] as const) {
    test(`publication decision preserves the financial approval block ${JSON.stringify(blocked)}`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, 'operator');
      options.edited.set(context.id, blocked);
      await page.goto(context.path('publication'));
      await expect(hook(page, 'sponsorship-approve')).toBeDisabled();
      await expect(
        hook(page, 'publication-decision-unavailable')
      ).toContainText(/rembours|litige|contest|refund|disput/i);
      expect(writes(calls)).toEqual([]);
    });
  }

  test('publication decision stays global for multiple recorded prestations', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'operator');
    options.progressOverrides = {
      commitment: context.recordedCommitment(50000),
      publications: [],
      publicationBlockers: ['review'],
      publicationCompletion: { done: 0, total: 3 }
    };
    await page.goto(context.path('publication'));
    await expect(hook(page, 'publication-service')).toHaveCount(3);
    await expect(hook(page, 'publication-decision')).toHaveCount(1);
    await expect(hook(page, 'sponsorship-approve')).toHaveCount(1);
    await expect(hook(page, 'publication-monitor-blockers')).toHaveCount(0);
    for (const card of await hook(page, 'publication-service').all()) {
      await expect(
        card.getByRole('button', { name: /^(Détails|Details)$/ })
      ).toHaveCount(1);
      await expect(
        card.locator('[data-og7="sponsorship-approve"]')
      ).toHaveCount(0);
    }
    expect(writes(calls)).toEqual([]);
  });

  test('publication decision does not invent prestations or deliveries for an unknown agreement', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'operator');
    options.progressOverrides = {
      commitment: null,
      publications: [],
      publicationCompletion: { done: 0, total: 0 }
    };
    await page.goto(context.path('publication'));
    await expect(hook(page, 'publication-decision')).toBeVisible();
    await expect(hook(page, 'publication-service')).toHaveCount(0);
    await openPublicationAnalysis(page);
    await expect(
      hook(page, 'publication-monitor').getByRole('progressbar')
    ).toHaveCount(0);
    await expect(hook(page, 'publication-monitor-empty')).toContainText(
      'Les prestations dues ne peuvent pas être déterminées sans accord qualifié.'
    );
    expect(writes(calls)).toEqual([]);
  });

  test('publication decision keeps disabled Preflight secondary without implying successful verification', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'operator');
    options.progressOverrides = {
      commitment: context.recordedCommitment(50000)
    };
    await page.route(
      '**/api/admin/sponsorships/publication-workshop?**',
      (route) =>
        route.fulfill({
          json: {
            contributionId: context.id,
            enabled: false,
            sourceVersion: null,
            sourceSnapshotDigest: null,
            mission: null,
            proposal: null,
            history: [],
            canPrepare: false,
            canAdopt: false
          }
        })
    );
    await page.goto(context.path('publication'));
    await expect(hook(page, 'publication-decision')).toContainText(
      'Décision humaine attendue'
    );
    await expect(hook(page, 'publication-preparation-preflight')).toBeHidden();
    await openPublicationAnalysis(page);
    await expect(
      hook(page, 'publication-preparation-preflight')
    ).toHaveAttribute('data-state', 'disabled');
    await expect(hook(page, 'publication-preparation-preflight')).toContainText(
      'Désactivé'
    );
    expect(writes(calls)).toEqual([]);
  });

  test('publication decision composition stays confined to the Publication tab', async ({
    page
  }) => {
    const { calls } = await context.fixtures(page, 'operator');
    await page.goto(context.path('publication'));
    const tabs = hook(page, 'dossier-tabs');
    await expect(tabs.getByRole('button')).toHaveCount(6);
    await expect(hook(page, 'publication-decision')).toBeVisible();
    for (const [tab, name] of [
      ['overview', 'Aperçu'],
      ['identity', 'Identité'],
      ['media', 'Fiche et médias'],
      ['billing', 'Finances'],
      ['audit', 'Historique']
    ] as const) {
      await tabs.getByRole('button', { name, exact: true }).click();
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('tab') === tab
      );
      await expect(hook(page, 'publication-monitor')).toHaveCount(0);
      await expect(hook(page, 'publication-decision')).toHaveCount(0);
      await expect(tabs.getByRole('button')).toHaveCount(6);
    }
    await tabs
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await expect(hook(page, 'publication-decision')).toBeVisible();
    expect(writes(calls)).toEqual([]);
  });
}
