import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipProgressResponse,
  SponsorshipCommitmentRecord,
  SponsorshipFulfilmentEvidence,
  SponsorshipObligation,
  SponsorshipPublicationWorkflowObligation
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface Context {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<{
    calls: readonly { method: string; url: URL }[];
    options: {
      status: number;
      state: AdminSponsorshipProgressResponse['status'];
      progressGate: Promise<void> | null;
      progressOverrides: Partial<AdminSponsorshipProgress>;
    };
  }>;
  path(tab?: string, value?: string): string;
  recordedCommitment(amountMinor: number): SponsorshipCommitmentRecord;
}

const dossierId = '10000000-0000-4000-8000-000000000401';
const observedAt = '2026-10-18T12:00:00Z';
const obligationId = (index: number) =>
  `10000000-0000-4000-8000-${String(6100 + index).padStart(12, '0')}`;
const evidenceId = (index: number) =>
  `10000000-0000-4000-8000-${String(6200 + index).padStart(12, '0')}`;
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

/** Six recorded occurrences differ from the three benefits and legacy drafts. */
function serviceFacts(context: Context): Partial<AdminSponsorshipProgress> {
  const captured = context.recordedCommitment(50000);
  const seed = captured.obligations[0]!;
  const obligation = (
    index: number,
    changes: Partial<SponsorshipObligation>
  ): SponsorshipObligation => ({
    ...seed,
    id: obligationId(index),
    ...changes
  });
  const obligations: SponsorshipObligation[] = [
    obligation(1, {
      state: 'fulfilled',
      fulfilmentEvidenceId: evidenceId(1)
    }),
    obligation(2, {
      benefitId: 'facebook_batch',
      channel: 'facebook',
      format: 'collective_text',
      state: 'fulfilled',
      fulfilmentEvidenceId: evidenceId(2)
    }),
    obligation(3, {
      benefitId: 'facebook_batch',
      channel: 'facebook',
      ordinal: 2,
      format: 'collective_text',
      state: 'fulfilled',
      fulfilmentEvidenceId: evidenceId(3)
    }),
    obligation(4, {
      benefitId: 'linkedin_batch',
      channel: 'linkedin',
      target: 'openg20',
      format: 'collective_text',
      state: 'adjusted'
    }),
    obligation(5, {
      benefitId: 'linkedin_batch',
      channel: 'linkedin',
      ordinal: 2,
      format: 'collective_text'
    }),
    obligation(6, {
      target: 'openg20',
      ordinal: 2,
      timing: {
        version: 1,
        deadlineDays: null,
        durationDays: 30,
        originAt: observedAt,
        originProvenance: 'activation',
        dueAt: null,
        overdue: false,
        durationState: 'awaiting_review',
        startObservation: {
          id: 'synthetic-start-observation',
          observedAt,
          earliestCompletionAt: '2026-11-17T12:00:00Z'
        }
      }
    })
  ];
  const proof = (
    index: number,
    channel: SponsorshipObligation['channel']
  ): SponsorshipFulfilmentEvidence => ({
    id: evidenceId(index),
    obligationId: obligationId(index),
    deliveryId: channel === 'website' ? null : 'synthetic-qualified-delivery',
    channel,
    target: 'openg7',
    provenance:
      channel === 'website' ? 'website_verified' : 'provider_verified',
    deliveredAt: observedAt,
    externalPostUrl:
      channel === 'website'
        ? null
        : 'https://example.invalid/qualified-service',
    visibility: channel === 'website' ? 'missing' : 'visible',
    visibilityObservedAt: observedAt
  });
  const workflow = (
    item: SponsorshipObligation,
    index: number
  ): SponsorshipPublicationWorkflowObligation => ({
    obligationId: item.id,
    channel: item.channel,
    target: item.target,
    ordinal: item.ordinal,
    deliveryId: null,
    scheduledAt: null,
    state: index < 4 ? 'complete' : 'action_required',
    responsibility: index < 4 ? 'none' : 'admin',
    reason: [
      'publication_done',
      'publication_done',
      'fulfilment_unverified',
      'obligation_adjusted',
      'publication_simulation',
      'duration_in_progress'
    ][index]!
  });
  return {
    commitment: { ...captured, obligations },
    qualifiedFulfilmentEvidenceIds: [evidenceId(1), evidenceId(2)],
    // An existing but unqualified proof cannot complete the third occurrence.
    fulfilmentEvidence: [
      proof(1, 'website'),
      proof(2, 'facebook'),
      proof(3, 'facebook')
    ],
    publicationCompletion: { done: 5, total: 6 },
    website: {
      visible: false,
      held: false,
      canPublish: false,
      version: 'synthetic-hidden-after-delivery',
      blockers: []
    },
    publicationWorkflow: {
      state: 'action_required',
      responsibility: 'admin',
      reason: 'fulfilment_unverified',
      obligations: obligations.map(workflow)
    },
    // Neither a mock result nor a historical declaration creates an occurrence.
    publications: Array.from({ length: 3 }, (_, index) => ({
      id: `synthetic-declared-or-mock-${index}`,
      channel: 'linkedin',
      target: 'openg7',
      status: 'published',
      batchStatus: 'published',
      slotStatus: null,
      deliveryStatus: 'published',
      deliveryMode: index === 0 ? 'mock' : null,
      scheduledAt: observedAt,
      publishedAt: observedAt
    }))
  };
}

async function locale(page: Page, language: 'fr-CA' | 'en') {
  await page.addInitScript(
    (value) => localStorage.setItem('openg7.language', value),
    language
  );
}

async function openOverview(page: Page, url: string): Promise<void> {
  const projection = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/admin/sponsorships/progress' &&
      response.status() === 200
  );
  await page.goto(url);
  await (await projection).finished();
}

const services = (page: Page) =>
  page.locator('[data-og7="overview-stat"][data-og7-id="services"]');

/** Detailed fulfilment stays with Publication; Overview counts the same qualified facts. */
export function registerDossierServiceSummaryTests(context: Context): void {
  for (const language of ['fr-CA', 'en'] as const) {
    for (const width of [1536, 390]) {
      test(`overview service statistic uses exact occurrences and qualified results in ${language} at ${width}px`, async ({
        page
      }, testInfo) => {
        const { calls, options } = await context.fixtures(page, 'reader');
        options.progressOverrides = serviceFacts(context);
        await locale(page, language);
        await page.setViewportSize({ width, height: 864 });
        await openOverview(page, context.path());
        await expect(services(page)).toContainText(/2\s*\/\s*6/);
        // Waivers, unqualified proofs, mock publication and declared totals add no deliveries.
        await expect(
          hook(page, 'overview-stat').filter({
            hasText: language === 'en' ? 'Public profile' : 'Fiche publique'
          })
        ).toContainText(language === 'en' ? 'Hidden' : 'Masquée');
        await expect(hook(page, 'dossier-service-summary')).toHaveCount(0);
        await expect(hook(page, 'dossier-service-row')).toHaveCount(0);
        expect(
          (
            await new AxeBuilder({ page })
              .include('openg7-admin-sponsor-detail-overview')
              .analyze()
          ).violations
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(
            `overview-services-${language}-${width}.png`
          ),
          animations: 'disabled'
        });
        const open = services(page);
        await open.focus();
        await open.press('Enter');
        await expect(page).toHaveURL(/tab=publication/);
        await expect(hook(page, 'publication-monitor')).toBeVisible();
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }

    test(`overview service statistic distinguishes unavailable, unconfirmed and known empty agreements in ${language}`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, 'reader');
      await locale(page, language);
      await openOverview(page, context.path());
      await expect(services(page)).toContainText(/Indisponible|Unavailable/);
      options.progressOverrides = {
        commitment: {
          ...context.recordedCommitment(50000),
          state: 'needs_confirmation'
        }
      };
      await hook(page, 'dossier-refresh').click();
      await expect(services(page)).toContainText(/Indisponible|Unavailable/);
      options.progressOverrides = {
        commitment: { ...context.recordedCommitment(50000), obligations: [] }
      };
      await hook(page, 'dossier-refresh').click();
      await expect(services(page)).toContainText(/0\s*\/\s*0/);
      options.progressOverrides = {
        commitment: context.recordedCommitment(50000)
      };
      await hook(page, 'dossier-refresh').click();
      await expect(services(page)).toContainText(/0\s*\/\s*3/);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`overview statistics clear private facts during refresh, errors and denied access in ${language}`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, 'reader');
      options.progressOverrides = serviceFacts(context);
      await locale(page, language);
      await openOverview(page, context.path());
      await expect(services(page)).toContainText(/2\s*\/\s*6/);
      const progress = hook(page, 'sponsorship-progress');
      const refreshProgress = async (status: 200 | 401 | 403 | 503) => {
        options.status = status;
        let release!: () => void;
        options.progressGate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const response = page.waitForResponse((entry) => {
          const url = new URL(entry.url());
          return (
            entry.request().method() === 'GET' &&
            url.pathname === '/api/admin/sponsorships/progress' &&
            url.searchParams.get('sponsorshipId') === dossierId &&
            entry.status() === status
          );
        });
        try {
          await hook(page, 'dossier-refresh').click();
          await expect(progress).toHaveAttribute('aria-busy', 'true');
          await expect(services(page)).toContainText(
            /Indisponible|Unavailable/
          );
          await expect(hook(page, 'overview-priority-action')).toHaveCount(0);
        } finally {
          options.progressGate = null;
          release();
        }
        await (await response).finished();
        if (status !== 401)
          await expect(progress).toHaveAttribute('aria-busy', 'false');
      };
      await refreshProgress(200);
      await expect(services(page)).toContainText(/2\s*\/\s*6/);
      for (const status of [503, 403] as const) {
        await refreshProgress(status);
        await expect(progress.getByRole('alert')).toBeVisible();
        await expect(services(page)).toContainText(/Indisponible|Unavailable/);
      }
      await refreshProgress(200);
      await expect(services(page)).toContainText(/2\s*\/\s*6/);
      await refreshProgress(401);
      await expect(page).toHaveURL(/\/admin\/login/);
      await expect(hook(page, 'overview-stat')).toHaveCount(0);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`overview statistics follow the selected dossier and stay out of other tabs in ${language}`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, 'reader');
      options.progressOverrides = serviceFacts(context);
      await locale(page, language);
      await page.goto('/admin/fundraiser/sponsors');
      await hook(page, 'sponsor-row').first().click();
      await expect(services(page)).toContainText(/2\s*\/\s*6/);
      const tabs = hook(page, 'dossier-tabs');
      await tabs
        .getByRole('button', { name: 'Publication', exact: true })
        .click();
      await expect(hook(page, 'overview-stat')).toHaveCount(0);
      await tabs
        .getByRole('button', {
          name: language === 'en' ? 'Overview' : 'Aperçu',
          exact: true
        })
        .click();
      await expect(services(page)).toContainText(/2\s*\/\s*6/);
      options.progressOverrides = {};
      await page
        .getByRole('button', {
          name: language === 'en' ? 'Next dossier' : 'Dossier suivant',
          exact: true
        })
        .click();
      await expect(services(page)).toContainText(/Indisponible|Unavailable/);
      await expect(hook(page, 'dossier-service-row')).toHaveCount(0);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }
}
