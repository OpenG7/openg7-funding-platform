import type { Page } from '@playwright/test';
import type { AdminSponsorshipProgress } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface ProgressFixtureOptions {
  next: AdminSponsorshipProgress['next'] | null;
  milestones: AdminSponsorshipProgress['milestones'] | null;
  progressOverrides: Partial<AdminSponsorshipProgress>;
}

/** Render private commercial blockers without inventing payment or fulfilment. */
export function registerSponsorshipObligationProgressTests(ports: {
  setup(page: Page): Promise<{
    options: ProgressFixtureOptions;
    calls: readonly { method: string }[];
  }>;
  path(tab?: string): string;
  dossier(): AdminSponsorshipProgress;
}): void {
  for (const english of [false, true]) {
    test(
      'commercial obligation blockers have translated reasons and actionable links ' +
        (english ? 'EN mobile' : 'FR desktop'),
      async ({ page }) => {
        const { options, calls } = await ports.setup(page);
        await page.setViewportSize(
          english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
        );
        options.milestones = ports.dossier().milestones.map((step) =>
          step.id === 'publication'
            ? {
                ...step,
                state: 'blocked',
                reason: 'commitment_needs_confirmation'
              }
            : { ...step, state: 'complete' }
        );
        options.next = {
          reason: 'commitment_needs_confirmation',
          tab: 'publication',
          adminUrl: ports.path('publication')
        };
        options.progressOverrides = {
          reviewStatus: 'approved',
          commitment: null,
          publications: [],
          publicationCompletion: { done: 0, total: 0 },
          publicationBlockers: ['commitment_needs_confirmation']
        };
        await page.goto(ports.path('publication'));
        if (english)
          await page
            .getByRole('button', {
              name: 'Switch administration language to English'
            })
            .click();
        const progress = page.locator('[data-og7="sponsorship-progress"]');
        const journey = page.locator(
          '[data-og7="dossier-publication-journey"]'
        );
        await expect(
          progress.locator('[data-og7-id="publication"]')
        ).toHaveAttribute('data-state', 'blocked');
        await expect(progress).toContainText(
          english ? 'Commitments need confirmation' : 'Engagements à qualifier'
        );
        await expect(
          journey.getByRole('link', {
            name: english
              ? 'Check the accepted offer or evidence of historical commitments'
              : 'Vérifier l’offre acceptée ou les justificatifs des engagements historiques'
          })
        ).toHaveAttribute('href', ports.path('overview'));
        const guide = page.locator('[data-og7="dossier-guide"]');
        await guide.locator('summary').click();
        await expect(guide.locator('[data-og7="guide-reason"]')).toContainText(
          english ? 'Commitments need confirmation' : 'Engagements à qualifier'
        );
        for (const panel of [progress, guide, journey]) {
          await expect(panel).not.toContainText('admin.dossier.reasons.');
          await expect(panel).not.toContainText(
            'admin.dossier.publicationBridge.blocker.'
          );
        }

        options.milestones = options.milestones.map((step) =>
          step.id === 'publication'
            ? { ...step, reason: 'publication_blocked' }
            : step
        );
        options.next = {
          reason: 'publication_blocked',
          tab: 'publication',
          adminUrl: ports.path('publication')
        };
        const contributionId = ports.dossier().contributionId;
        options.progressOverrides = {
          ...options.progressOverrides,
          commitment: {
            id: '10000000-0000-4000-8000-000000000501',
            contributionId,
            offerId: '10000000-0000-4000-8000-000000000502',
            provenance: 'qualified_historical',
            state: 'active',
            qualificationReason: null,
            version: 1,
            offer: {
              version: 'historical-qualification-v1',
              amountMinor: 50000,
              currency: 'CAD',
              benefits: [
                {
                  id: 'facebook_batch',
                  channel: 'facebook',
                  target: 'openg7',
                  quantity: 1,
                  requiredElements: ['approved_logo', 'approved_presentation'],
                  deadlineDays: null,
                  durationDays: null
                }
              ]
            },
            obligations: [
              {
                id: '10000000-0000-4000-8000-000000000503',
                commitmentId: '10000000-0000-4000-8000-000000000501',
                contributionId,
                benefitId: 'facebook_batch',
                channel: 'facebook',
                target: 'openg7',
                ordinal: 1,
                state: 'blocked',
                blockedReason: 'required_elements_missing',
                version: 1,
                fulfilmentEvidenceId: null
              }
            ]
          },
          publicationCompletion: { done: 0, total: 1 },
          publicationBlockers: ['media']
        };
        await page.reload();
        await expect(
          progress.locator('[data-og7-id="publication"]')
        ).toHaveAttribute('data-state', 'blocked');
        const media = journey.getByRole('link', {
          name: english
            ? 'Review and approve the media required by the commitments'
            : 'Vérifier et approuver les médias requis par les engagements'
        });
        await expect(media).toHaveAttribute('href', ports.path('media'));
        await media.focus();
        await expect(media).toBeFocused();
        await media.press('Enter');
        await expect(page).toHaveURL(/tab=media/);
        expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
      }
    );
  }
}
