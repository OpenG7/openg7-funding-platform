import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipRecord,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const sponsorshipId = '10000000-0000-4000-8000-000000000401';

interface Context {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<{
    calls: readonly {
      method: string;
      url: URL;
      body: Record<string, unknown> | null;
    }[];
    options: {
      edited: Map<string, Partial<AdminSponsorshipRecord>>;
      progressOverrides: Partial<AdminSponsorshipProgress>;
    };
  }>;
  path(tab?: string, value?: string): string;
  recordedCommitment(amountMinor: number): SponsorshipCommitmentRecord;
}

export function registerSponsorPublicationCleanupTests(context: Context): void {
  test('publication benefit summary opens Campaigns for the current sponsorship', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'reader');
    options.progressOverrides = {
      commitment: context.recordedCommitment(50000),
      publicationCompletion: { done: 0, total: 3 },
      publicationWorkflow: {
        state: 'waiting',
        responsibility: 'platform',
        reason: 'publication_scheduled',
        obligations: [
          {
            obligationId: 'synthetic-benefit-summary',
            channel: 'facebook',
            target: 'openg7',
            ordinal: 1,
            state: 'waiting',
            responsibility: 'platform',
            reason: 'publication_scheduled',
            deliveryId: null,
            scheduledAt: '2030-06-04T14:00:00Z'
          }
        ]
      }
    };
    await page.goto(context.path('publication'));
    const summary = page.locator('[data-og7="publication-obligations"]');
    await expect(summary).toContainText('Prochaine étape : plateforme.');
    const campaign = summary.locator(
      '[data-og7="publication-campaign-benefits"]'
    );
    await expect(campaign).toHaveAttribute(
      'href',
      `/admin/fundraiser/campaigns?sponsorshipId=${sponsorshipId}`
    );
    await expect(summary.locator('[data-og7-id]')).toHaveCount(0);
    await expect(
      page.locator('[data-og7="publication-channel"]').first()
    ).toBeVisible();
    await campaign.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new RegExp(
        `/admin/fundraiser/campaigns\\?sponsorshipId=${sponsorshipId}$`
      )
    );
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  for (const [language, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    test(`publication settings separate the public profile and declared social tracking in ${language}`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, 'owner');
      options.edited.set(sponsorshipId, { sponsor_review_status: 'approved' });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(context.path('publication'));
      const advanced = page.locator('[data-og7="publication-advanced"]');
      await advanced.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      const profile = advanced.locator(
        '[data-og7="publication-profile-settings"]'
      );
      const historical = advanced.locator(
        '[data-og7="publication-declared-tracking"]'
      );
      await expect(profile.getByRole('heading', { level: 3 })).toHaveText(
        language === 'en' ? 'Public profile' : 'Fiche publique'
      );
      await expect(profile.locator('input, textarea')).toHaveCount(2);
      await expect(
        profile.locator('[data-og7="publication-manual-status"]')
      ).toHaveCount(0);
      await expect(historical.locator('select').first()).toBeHidden();
      await expect(advanced).toContainText(
        language === 'en'
          ? 'does not publish the profile or authorize a social delivery'
          : 'ne publie pas la fiche et n’autorise aucun envoi social'
      );
      await profile
        .locator('[data-og7="publication-public-summary"] textarea')
        .fill('Synthetic public summary');
      await historical.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      await expect(historical.locator('select').first()).toBeVisible();
      await historical
        .locator('[data-og7="publication-manual-notes"] textarea')
        .fill('Synthetic private tracking');
      await expect(
        advanced.locator('[data-og7="publication-public-preview"]')
      ).not.toContainText('Synthetic private tracking');
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
      await advanced.locator('[data-og7="publication-tracking-save"]').click();
      await expect
        .poll(
          () =>
            calls.filter(
              (call) =>
                call.method === 'POST' &&
                call.url.pathname === '/api/admin/sponsorships/publication'
            ).length
        )
        .toBe(1);
      const mutation = calls.find(
        (call) =>
          call.method === 'POST' &&
          call.url.pathname === '/api/admin/sponsorships/publication'
      );
      expect(mutation?.body).toMatchObject({
        contributionId: sponsorshipId,
        confirmation: sponsorshipId,
        expectedVersion: 'v1',
        publicSummary: 'Synthetic public summary',
        feedNotes: 'Synthetic private tracking',
        feedStatus: 'not_planned'
      });
      expect(
        calls.filter(
          (call) =>
            call.method === 'POST' &&
            call.url.pathname.includes('publication-automation')
        )
      ).toEqual([]);
      await expect(
        advanced.locator('[data-og7="publication-tracking-save"]')
      ).toBeDisabled();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="dossier-publication-editor"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }

  test('readers retain both publication settings scopes without mutation controls', async ({
    page
  }) => {
    const { calls } = await context.fixtures(page, 'reader');
    await page.goto(context.path('publication'));
    const advanced = page.locator('[data-og7="publication-advanced"]');
    await advanced.locator(':scope > summary').click();
    await advanced
      .locator('[data-og7="publication-declared-tracking"] > summary')
      .click();
    for (const control of await advanced
      .locator('input, select, textarea')
      .all())
      await expect(control).toBeDisabled();
    await expect(
      advanced.locator('[data-og7="publication-tracking-save"]')
    ).toBeDisabled();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}
