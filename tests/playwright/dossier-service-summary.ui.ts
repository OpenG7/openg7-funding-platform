import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminCampaignItem,
  AdminDossierPreparationReceipt,
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
const secondId = '10000000-0000-4000-8000-000000000402';
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

function campaignRow(
  facts: Partial<AdminSponsorshipProgress>
): AdminCampaignItem {
  const item = facts.commitment!.obligations[1]!;
  return {
    id: item.id,
    contributionId: dossierId,
    reference: 'DEMO-401',
    companyName: 'Atelier Boréal',
    paidAt: observedAt,
    channel: item.channel,
    target: item.target,
    ordinal: item.ordinal,
    quantity: 2,
    format: item.format ?? null,
    obligationState: item.state,
    timing: item.timing ?? null,
    preparation: {
      status: 'incomplete',
      version: 'synthetic-service-summary-v1',
      approvedAt: null,
      blockers: []
    },
    workflow: facts.publicationWorkflow!.obligations[1]!,
    content: {
      title: 'Atelier Boréal',
      body: 'Contenu de recette synthétique.'
    },
    proof: facts.fulfilmentEvidence![1]!,
    adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=publication`
  };
}

export function registerDossierServiceSummaryTests(context: Context): void {
  for (const language of ['fr-CA', 'en'] as const) {
    for (const width of [1536, 390]) {
      test(`dossier service summary preserves exact occurrences and qualified results in ${language} at ${width}px`, async ({
        page
      }, testInfo) => {
        const { calls, options } = await context.fixtures(page, 'reader');
        const facts = serviceFacts(context);
        options.progressOverrides = facts;
        await locale(page, language);
        await page.setViewportSize({ width, height: 864 });
        const campaignQueries: URLSearchParams[] = [];
        const campaign = campaignRow(facts);
        await page.route('**/api/admin/campaigns?**', (route) => {
          expect(route.request().method()).toBe('GET');
          campaignQueries.push(new URL(route.request().url()).searchParams);
          return route.fulfill({
            json: {
              generatedAt: observedAt,
              items: [campaign],
              pagination: {
                page: 1,
                pageSize: 25,
                totalItems: 1,
                totalPages: 1,
                hasPreviousPage: false,
                hasNextPage: false
              }
            }
          });
        });
        const preparation: AdminDossierPreparationReceipt = {
          context: 'dossier',
          contributionId: dossierId,
          reference: 'DEMO-401',
          version: campaign.preparation.version,
          status: 'incomplete',
          payment: {
            amountMinor: 50000,
            currency: 'CAD',
            status: 'paid',
            confirmedAt: observedAt
          },
          acceptedOffer: null,
          balance: null,
          checks: [{ code: 'payment_confirmed', state: 'complete' }],
          authorizations: [],
          drafts: [],
          blockers: [],
          canApprove: false,
          approval: null,
          approvalHistory: []
        };
        await page.route('**/api/admin/sponsorships/preparation?**', (route) =>
          route.fulfill({ json: preparation })
        );
        await page.goto(context.path());
        const summary = hook(page, 'dossier-service-summary');
        await expect(summary).toBeVisible();
        await expect(summary.getByRole('heading')).toHaveText(
          language === 'en'
            ? 'Dossier service fulfilment'
            : 'Suivi des prestations du dossier'
        );
        await expect(hook(page, 'dossier-service-row')).toHaveCount(6);
        for (const [counter, text] of [
          ['fulfilled', language === 'en' ? '2 fulfilled' : '2 réalisées'],
          ['adjusted', language === 'en' ? '1 waived' : '1 dispensée'],
          ['remaining', language === 'en' ? '3 remaining' : '3 à réaliser']
        ] as const)
          await expect(hook(page, `dossier-services-${counter}`)).toHaveText(
            text
          );
        const rows = hook(page, 'dossier-service-row');
        for (const [index, state] of [
          [0, 'fulfilled'],
          [1, 'fulfilled'],
          [2, 'unverified'],
          [3, 'adjusted'],
          [4, 'action_required'],
          [5, 'action_required']
        ] as const)
          await expect(rows.nth(index)).toHaveAttribute('data-state', state);
        await expect(rows.nth(0)).toContainText('OpenG7');
        await expect(rows.nth(0)).toContainText(
          language === 'en'
            ? 'Current profile visibility: hidden'
            : 'Visibilité actuelle de la fiche : masquée'
        );
        await expect(rows.nth(1)).toContainText('Facebook');
        await expect(rows.nth(2)).toContainText(
          language === 'en' ? 'no. 2' : 'nº 2'
        );
        await expect(rows.nth(3)).toContainText('LinkedIn');
        await expect(rows.nth(3)).toContainText('OpenG20');
        await expect(rows.nth(5)).toContainText('OpenG20');
        await expect(rows.nth(5)).not.toContainText(
          language === 'en'
            ? 'Current profile visibility:'
            : 'Visibilité actuelle de la fiche :'
        );
        await expect(rows.nth(5)).toContainText(
          language === 'en' ? 'duration' : 'Durée'
        );
        for (const item of facts.commitment!.obligations) {
          const row = summary.locator(
            `[data-og7="dossier-service-row"][data-og7-id="${item.id}"]`
          );
          await expect(row).toBeVisible();
          await expect(
            row.locator('[data-og7="dossier-service-detail"]')
          ).toHaveAttribute(
            'href',
            `/admin/fundraiser/campaigns?sponsorshipId=${dossierId}&obligationId=${item.id}`
          );
        }
        await expect(summary.locator('button')).toHaveCount(0);
        await expect(hook(page, 'dossier-next')).toHaveCount(1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="dossier-service-summary"]')
              .analyze()
          ).violations
        ).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`service-summary-${language}-${width}.png`),
          fullPage: true,
          animations: 'disabled'
        });

        // A real keyboard activation must deliver the exact scope to its owner.
        const detail = rows
          .nth(1)
          .locator('[data-og7="dossier-service-detail"]');
        await detail.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(
          `/admin/fundraiser/campaigns?sponsorshipId=${dossierId}&obligationId=${campaign.id}`
        );
        await expect(hook(page, 'campaign-row')).toHaveCount(1);
        await expect(hook(page, 'campaign-row')).toHaveAttribute(
          'data-og7-id',
          campaign.id
        );
        await expect(hook(page, 'campaign-detail')).toBeVisible();
        expect(campaignQueries.at(-1)?.get('sponsorshipId')).toBe(dossierId);
        expect(campaignQueries.at(-1)?.get('obligationId')).toBe(campaign.id);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }

    test(`dossier service summary explains missing and older server facts in ${language}`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, 'reader');
      await locale(page, language);
      await page.setViewportSize({
        width: language === 'en' ? 390 : 1536,
        height: 864
      });
      await page.goto(context.path());
      const summary = hook(page, 'dossier-service-summary');
      await expect(summary).toBeVisible();
      await expect(hook(page, 'dossier-service-row')).toHaveCount(0);
      await expect(hook(page, 'dossier-services-fulfilled')).toHaveCount(0);
      await expect(summary).toContainText(
        language === 'en'
          ? 'The promised services have not been documented yet.'
          : 'Les prestations promises ne sont pas encore documentées.'
      );

      options.progressOverrides = {
        commitment: {
          ...context.recordedCommitment(50000),
          state: 'needs_confirmation'
        }
      };
      await hook(page, 'dossier-refresh').click();
      await expect(summary).toContainText(
        language === 'en'
          ? 'Confirm the agreement before reviewing the promised services.'
          : 'L’accord doit être confirmé avant de récapituler les prestations.'
      );
      await expect(hook(page, 'dossier-service-row')).toHaveCount(0);
      await expect(hook(page, 'dossier-services-fulfilled')).toHaveCount(0);

      options.progressOverrides = {
        commitment: { ...context.recordedCommitment(50000), obligations: [] }
      };
      await hook(page, 'dossier-refresh').click();
      await expect(summary).toContainText(
        language === 'en'
          ? 'No services have been recorded for this agreement yet.'
          : 'Aucune prestation n’est encore enregistrée pour cet accord.'
      );
      await expect(hook(page, 'dossier-service-row')).toHaveCount(0);
      await expect(hook(page, 'dossier-services-fulfilled')).toHaveCount(0);

      // Exact promises remain visible, but old servers supply no workflow verdict.
      options.progressOverrides = {
        commitment: context.recordedCommitment(50000)
      };
      await hook(page, 'dossier-refresh').click();
      await expect(hook(page, 'dossier-service-row')).toHaveCount(3);
      await expect(hook(page, 'dossier-services-fulfilled')).toContainText('0');
      await expect(hook(page, 'dossier-services-remaining')).toContainText('3');
      await expect(hook(page, 'dossier-service-row').first()).toContainText(
        language === 'en' ? 'Tracking unavailable' : 'Suivi indisponible'
      );
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`dossier service summary clears private facts through refresh errors and access denial in ${language}`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, 'reader');
      options.progressOverrides = serviceFacts(context);
      await locale(page, language);
      await page.goto(context.path());
      await expect(hook(page, 'dossier-service-row')).toHaveCount(6);
      await page.reload();
      await expect(hook(page, 'dossier-service-row')).toHaveCount(6);
      let release!: () => void;
      options.progressGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await hook(page, 'dossier-refresh').click();
        await expect(hook(page, 'sponsorship-progress')).toHaveAttribute(
          'aria-busy',
          'true'
        );
        await expect(hook(page, 'dossier-service-summary')).toHaveCount(0);
        await expect(hook(page, 'dossier-service-row')).toHaveCount(0);
      } finally {
        options.progressGate = null;
        release();
      }
      await expect(hook(page, 'dossier-service-row')).toHaveCount(6);
      for (const status of [503, 403]) {
        options.status = status;
        await hook(page, 'dossier-refresh').click();
        await expect(
          hook(page, 'sponsorship-progress').getByRole('alert')
        ).toBeVisible();
        await expect(hook(page, 'dossier-service-summary')).toHaveCount(0);
        await expect(hook(page, 'dossier-service-row')).toHaveCount(0);
      }
      options.status = 200;
      await hook(page, 'dossier-refresh').click();
      await expect(hook(page, 'dossier-service-row')).toHaveCount(6);
      options.status = 401;
      await hook(page, 'dossier-refresh').click();
      await expect(page).toHaveURL(/\/admin\/login/);
      await expect(hook(page, 'dossier-service-row')).toHaveCount(0);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`dossier service summary follows the selected dossier and overview only in ${language}`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, 'reader');
      options.progressOverrides = serviceFacts(context);
      await locale(page, language);
      await page.setViewportSize({
        width: language === 'en' ? 390 : 1536,
        height: 864
      });
      // Opening from the unfiltered list preserves the two-dossier work queue.
      // A direct sponsorshipId URL intentionally narrows that list to one dossier.
      await page.goto('/admin/fundraiser/sponsors');
      await expect(hook(page, 'sponsor-row')).toHaveCount(2);
      await hook(page, 'sponsor-row').first().click();
      await expect(hook(page, 'dossier-service-row')).toHaveCount(6);
      const tabs = hook(page, 'dossier-tabs');
      await tabs
        .getByRole('button', { name: 'Publication', exact: true })
        .click();
      await expect(hook(page, 'dossier-service-summary')).toBeHidden();
      await tabs
        .getByRole('button', {
          name: language === 'en' ? 'Overview' : 'Aperçu',
          exact: true
        })
        .click();
      await expect(hook(page, 'dossier-service-summary')).toBeVisible();
      await expect(hook(page, 'dossier-service-row')).toHaveCount(6);

      options.progressOverrides = {};
      await page
        .getByRole('button', {
          name: language === 'en' ? 'Next dossier' : 'Dossier suivant',
          exact: true
        })
        .click();
      await expect(page).toHaveURL(context.path('overview', secondId));
      await expect(hook(page, 'dossier-service-summary')).toBeVisible();
      await expect(hook(page, 'dossier-service-row')).toHaveCount(0);
      await expect(hook(page, 'dossier-service-detail')).toHaveCount(0);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }
}
