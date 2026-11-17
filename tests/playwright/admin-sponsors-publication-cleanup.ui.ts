import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipRecord,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { expect, sampledFrames, test } from './support/test.js';
import { openPublicationSection } from './support/sponsorship-dossier.js';

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
  test('publication keeps agreed services collapsed and leaves their editor unmounted by default', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'owner');
    options.progressOverrides = {
      commitment: context.recordedCommitment(50000),
      publications: [],
      publicationCompletion: { done: 0, total: 3 }
    };
    await page.goto(context.path('publication'));
    const view = page.locator('[data-og7="publication-monitor"]');
    await expect(view).toBeVisible();
    await expect(view.locator('[data-og7="publication-service"]')).toHaveCount(
      3
    );
    await expect(page.locator('[data-og7="admin-commitments"]')).toHaveCount(0);
    await expect(
      page.locator('openg7-admin-sponsorship-commitments')
    ).toHaveCount(0);
    const terms = page.locator('[data-og7="publication-terms"]');
    await expect(terms).not.toHaveAttribute('open');
    await expect(
      terms.locator('[data-og7="publication-terms-toggle"]')
    ).toHaveText('Prestations convenues');
    await expect(
      page.locator('[data-og7="dossier-tool-toggle"][data-og7-id="agreement"]')
    ).toHaveCount(0);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  for (const [role, language, width] of [
    ['owner', 'fr-CA', 1280],
    ['reader', 'en', 390]
  ] as const) {
    test(`publication agreed services preserve ${role} access and keyboard disclosure in ${language}`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, role);
      options.progressOverrides = {
        commitment: context.recordedCommitment(50000),
        publications: [],
        publicationCompletion: { done: 0, total: 3 }
      };
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto(context.path('publication'));
      const terms = page.locator('[data-og7="publication-terms"]');
      const toggle = terms.locator('[data-og7="publication-terms-toggle"]');
      await expect(page.locator('[data-og7="admin-commitments"]')).toHaveCount(
        0
      );
      await expect(
        page.locator('[data-og7="publication-monitor"]')
      ).toBeVisible();
      await sampledFrames(page);
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.keyboard.press('Enter');
      const commitments = terms.locator('[data-og7="admin-commitments"]');
      await expect(terms).toHaveAttribute('open', '');
      await expect(toggle).toHaveText(
        language === 'en' ? 'Agreed services' : 'Prestations convenues'
      );
      await expect(commitments).toHaveCount(1);
      await expect(commitments).toBeVisible();
      await expect(
        commitments.locator('[data-og7="commitments-benefit-summary"]')
      ).toHaveCount(3);
      await expect(
        commitments.locator('[data-og7="commitments-accepted-offer"]')
      ).toBeHidden();
      await expect(
        commitments.locator(
          '[data-og7="commitments-benefit-summary"][data-og7-id="facebook_batch"]'
        )
      ).toHaveAccessibleName(
        language === 'en' ? /Collective text/ : /Texte collectif/
      );
      await expect(
        commitments.locator('[data-og7="commitments-obligations"]')
      ).toHaveCount(0);
      await expect(
        page.locator('[data-og7="publication-service"]')
      ).toHaveCount(3);
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(
        commitments.locator('[data-og7="commitments-adjust-open"]')
      ).toHaveCount(0);
      await expect(
        commitments.locator('[data-og7="commitments-qualification"]')
      ).toHaveCount(0);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="publication-terms"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(terms).not.toHaveAttribute('open');
      await expect(commitments).toBeHidden();
      await expect(toggle).toBeFocused();
      await expect(commitments).toHaveCount(1);
      await page
        .locator('[data-og7="publication-service-details"]')
        .first()
        .click();
      const adjust = page.locator('[data-og7="publication-service-adjust"]');
      if (role === 'owner') {
        await expect(adjust).toBeEnabled();
        await adjust.click();
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        await expect(terms).toHaveAttribute('open', '');
        await expect(
          commitments.locator('[data-og7="commitments-adjustment"]')
        ).toBeVisible();
      } else {
        await expect(adjust).toHaveCount(0);
        await expect(
          commitments.locator('[data-og7="commitments-adjustment"]')
        ).toHaveCount(0);
      }
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }

  test.describe('agreed service icons', () => {
    test.use({ hasTouch: true });

    for (const [role, language, width] of [
      ['owner', 'fr-CA', 1280],
      ['reader', 'en', 390]
    ] as const) {
      test(`agreed service icons disclose exact terms by keyboard and touch in ${language}`, async ({
        page
      }, testInfo) => {
        const { calls, options } = await context.fixtures(page, role);
        const original = context.recordedCommitment(35000);
        const offerReference = language === 'en' ? null : original.offerId;
        const benefits = original.offer!.benefits.map((benefit) => ({
          ...benefit,
          ...(benefit.channel === 'website'
            ? { durationDays: 30 }
            : benefit.channel === 'facebook'
              ? {
                  format: 'individual_portrait' as const,
                  target: 'openg20' as const,
                  quantity: 2,
                  deadlineDays: 7,
                  requiredElements: [
                    'company_name',
                    'approved_presentation',
                    'approved_logo'
                  ] as const
                }
              : language === 'en'
                ? { format: undefined, requiredElements: [] as const }
                : { format: 'collective_composite' as const })
        }));
        let nextObligation = 700;
        options.progressOverrides = {
          commitment: {
            ...original,
            offerId: offerReference,
            offer: { ...original.offer!, benefits },
            obligations: benefits.flatMap((benefit) => {
              const obligation = original.obligations.find(
                (item) => item.benefitId === benefit.id
              )!;
              return Array.from({ length: benefit.quantity }, (_, index) => ({
                ...obligation,
                id: `10000000-0000-4000-8000-${String(nextObligation++).padStart(12, '0')}`,
                channel: benefit.channel,
                target: benefit.target,
                format: benefit.format ?? null,
                ordinal: index + 1
              }));
            })
          },
          publications: []
        };
        await page.addInitScript(
          (locale) => localStorage.setItem('openg7.language', locale),
          language
        );
        await page.setViewportSize({ width, height: 900 });
        await page.goto(context.path('publication'));
        await openPublicationSection(page, 'contract');
        const editor = page.locator('[data-og7="admin-commitments"]');
        const details = editor.locator(
          '[data-og7="commitments-offer-details"]'
        );
        const complete = editor.locator(
          '[data-og7="commitments-accepted-offer"]'
        );
        await expect(details).not.toHaveAttribute('open');
        await expect(complete).toBeHidden();
        const facebook = editor.locator(
          '[data-og7="commitments-benefit-summary"][data-og7-id="facebook_batch"]'
        );
        const linkedin = editor.locator(
          '[data-og7="commitments-benefit-summary"][data-og7-id="linkedin_batch"]'
        );
        const website = editor.locator(
          '[data-og7="commitments-benefit-summary"][data-og7-id="website_mention"]'
        );
        await editor
          .locator('[data-og7="commitments-offer-summary"]')
          .screenshot({ path: testInfo.outputPath('offer-summary.png') });
        await expect(facebook).toContainText('OpenG20');
        await expect(facebook).toContainText(/×\s*2/);
        await expect(facebook).toHaveAccessibleName(/Facebook/);
        await expect(facebook).toHaveAccessibleName(
          language === 'en' ? /Individual portrait/ : /Portrait individuel/
        );
        await expect(facebook).toHaveAccessibleName(
          language === 'en' ? /7 day/ : /7 jour/
        );
        await expect(facebook).toContainText(language === 'en' ? '7 d' : '7 j');
        await expect(linkedin).toHaveAccessibleName(
          language === 'en'
            ? /Format not established — text only/
            : /Image collective/
        );
        await expect(linkedin).toHaveText(/OpenG7\s*×1\s*—\s*—/);
        await expect(linkedin).toHaveAccessibleName(
          language === 'en' ? /Not fixed/ : /Non fixé/
        );
        await expect(website).toHaveAccessibleName(
          language === 'en' ? /30 day/ : /30 jour/
        );
        await expect(website).toContainText(
          language === 'en' ? '30 d' : '30 j'
        );
        await facebook.hover();
        await expect(
          facebook.getByTitle(
            language === 'en'
              ? /Required.*Approved logo/
              : /Requis.*Logo approuvé/
          )
        ).toHaveCount(1);
        await facebook.focus();
        await expect(facebook).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(details).toHaveAttribute('open', '');
        await expect(
          complete.locator(':scope > li[data-og7-id="facebook_batch"]')
        ).toBeFocused();
        const facebookCard = complete.locator(
          ':scope > li[data-og7-id="facebook_batch"]'
        );
        await expect(facebookCard).toHaveAttribute('data-selected', 'true');
        const header = details.locator('[data-og7="commitments-offer-header"]');
        await expect(header).toContainText('350');
        await expect(header).toContainText('CAD');
        await expect(header).toContainText('Checkout');
        await expect(header).not.toContainText('500');
        await expect(header).not.toContainText(original.offer!.version);
        await expect(
          details.getByRole('heading', {
            name:
              language === 'en'
                ? 'Initially accepted terms'
                : 'Conditions initialement acceptées',
            exact: true
          })
        ).toBeVisible();
        await expect(
          facebookCard.locator('[data-og7="commitments-benefit-fields"]')
        ).toContainText(
          language === 'en' ? 'Individual portrait' : 'Portrait individuel'
        );
        await expect(
          facebookCard.locator('[data-og7="commitments-benefit-requirements"]')
        ).toContainText(language === 'en' ? 'Approved logo' : 'Logo approuvé');
        const traceability = details.locator(
          '[data-og7="commitments-offer-traceability"]'
        );
        await expect(traceability).not.toHaveAttribute('open');
        const version = traceability.getByText(original.offer!.version, {
          exact: true
        });
        await expect(version).toBeHidden();
        await details.screenshot({
          path: testInfo.outputPath('offer-details.png')
        });
        const disclosure = details.locator(':scope > summary');
        await expect(disclosure).toHaveText(
          language === 'en' ? 'Offer details' : 'Détails de l’offre'
        );
        const traceToggle = traceability.locator(':scope > summary');
        await traceToggle.focus();
        await page.keyboard.press('Enter');
        await expect(version).toBeVisible();
        await expect(traceability).toContainText(original.id);
        if (offerReference)
          await expect(traceability).toContainText(offerReference);
        else
          await expect(
            traceability.getByText('Offer reference', { exact: true })
          ).toHaveCount(0);
        const returnFacebook = facebookCard.locator(
          '[data-og7="commitments-return-summary"]'
        );
        await expect(returnFacebook).toHaveAccessibleName(
          language === 'en'
            ? /Back to summary.*Facebook.*OpenG20/
            : /Retour au résumé.*Facebook.*OpenG20/
        );
        await returnFacebook.focus();
        await page.keyboard.press('Enter');
        await expect(complete).toBeHidden();
        await expect(facebook).toBeFocused();
        await expect(
          page.locator('[data-og7="publication-terms"]')
        ).toHaveAttribute('open', '');
        await linkedin.tap();
        const linkedinCard = complete.locator(
          ':scope > li[data-og7-id="linkedin_batch"]'
        );
        await expect(linkedinCard).toBeFocused();
        await expect(linkedinCard).toHaveAttribute('data-selected', 'true');
        await expect(facebookCard).toHaveAttribute('data-selected', 'false');
        const partialFields = linkedinCard.locator(
          '[data-og7="commitments-benefit-fields"]'
        );
        await expect(
          partialFields.locator('dd').filter({
            hasText: language === 'en' ? 'Not fixed' : 'Non fixé'
          })
        ).toHaveCount(2);
        if (language === 'en') {
          await expect(partialFields).toContainText(
            'Format not established — text only'
          );
          await expect(
            linkedinCard.locator(
              '[data-og7="commitments-benefit-requirements"] li'
            )
          ).toHaveCount(0);
          await expect(
            linkedinCard.locator(
              '[data-og7="commitments-benefit-requirements"]'
            )
          ).toHaveText('No required elements recorded');
        }
        await expect(details).toHaveAttribute('open', '');
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="publication-terms"]')
              .analyze()
          ).violations
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        await linkedinCard
          .locator('[data-og7="commitments-return-summary"]')
          .tap();
        await expect(complete).toBeHidden();
        await expect(linkedin).toBeFocused();
        await expect(
          page.locator('[data-og7="publication-terms"]')
        ).toHaveAttribute('open', '');
        await linkedin.press('Enter');
        await expect(linkedinCard).toBeFocused();
        await disclosure.focus();
        await page.keyboard.press('Enter');
        await expect(details).not.toHaveAttribute('open');
        await expect(disclosure).toBeFocused();
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }
  });

  for (const fragment of [
    'dossier-agreement',
    'dossier-assistance-source',
    'dossier-assistance-review'
  ]) {
    test(`publication terms honor the existing ${fragment} deep link without a mutation`, async ({
      page
    }) => {
      const { calls, options } = await context.fixtures(page, 'owner');
      options.progressOverrides = {
        commitment: context.recordedCommitment(50000)
      };
      const destination = context.path('publication') + '#' + fragment;
      await page.goto(destination);
      const terms = page.locator('[data-og7="publication-terms"]');
      const toggle = terms.locator('[data-og7="publication-terms-toggle"]');
      await expect(page).toHaveURL(destination);
      await expect(terms).toHaveAttribute('open', '');
      await expect(
        terms.locator('[data-og7="admin-commitments"]')
      ).toBeVisible();
      await expect(terms.locator('[data-og7="admin-commitments"]')).toHaveCount(
        1
      );
      await expect(page.locator('[data-og7="admin-commitments"]')).toHaveCount(
        1
      );
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(terms).not.toHaveAttribute('open');
      await expect(page).toHaveURL(context.path('publication'));
      await expect(toggle).toBeFocused();
      await openPublicationSection(page, 'contract');
      await expect(terms).toHaveAttribute('open', '');
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }

  test('publication terms retain their mounted editor across tabs and reset for another dossier', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'owner');
    options.progressOverrides = {
      commitment: context.recordedCommitment(50000)
    };
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.goto(context.path('publication'));
    await openPublicationSection(page, 'contract');
    const terms = page.locator('[data-og7="publication-terms"]');
    const editor = page.locator('[data-og7="admin-commitments"]');
    await editor.evaluate((element) =>
      element.setAttribute('data-retained', 'yes')
    );
    await page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Identité', exact: true })
      .click();
    await expect(editor).toHaveCount(1);
    await expect(editor).toBeHidden();
    await openPublicationSection(page, 'contract');
    await expect(editor).toHaveAttribute('data-retained', 'yes');
    await expect(terms).toHaveAttribute('open', '');
    const secondId = '10000000-0000-4000-8000-000000000402';
    await page
      .locator('[data-og7="sponsors-list"]')
      .getByRole('searchbox')
      .fill('');
    const tools = page.locator('[data-og7="dossier-global-tools"]');
    if ((await tools.getAttribute('open')) === null)
      await tools.locator(':scope > summary').click();
    await expect(
      page.getByRole('button', { name: 'Dossier suivant', exact: true })
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Dossier suivant', exact: true })
      .click();
    await expect(page).toHaveURL(context.path('publication', secondId));
    await expect(editor).toHaveCount(0);
    await expect(terms).not.toHaveAttribute('open');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('publication terms reset their editor when the owner session changes', async ({
    page
  }) => {
    const { calls, options } = await context.fixtures(page, 'owner');
    options.progressOverrides = {
      commitment: context.recordedCommitment(50000)
    };
    let sessionId = 'synthetic-original-terms-session';
    let identityReads = 0;
    await page.route('**/api/admin/auth/current', async (route) => {
      identityReads++;
      await route.fulfill({
        json: {
          id: 'synthetic-terms-owner',
          sessionId,
          displayName: 'Synthetic owner',
          role: 'owner',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    });
    await page.goto(context.path('publication'));
    await openPublicationSection(page, 'contract');
    const editor = page.locator('[data-og7="admin-commitments"]');
    await editor.evaluate((element) =>
      element.setAttribute('data-retained', 'yes')
    );
    sessionId = 'synthetic-replacement-terms-session';
    const previousIdentityReads = identityReads;
    await page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Identité', exact: true })
      .click();
    await expect
      .poll(() => identityReads)
      .toBeGreaterThan(previousIdentityReads);
    await expect(editor).toHaveCount(0);
    await openPublicationSection(page, 'contract');
    await expect(editor).not.toHaveAttribute('data-retained');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('publication monitor leaves profile and historical settings in their media owner', async ({
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
    const view = page.locator('[data-og7="publication-monitor"]');
    await expect(view).toBeVisible();
    await expect(view.locator('input, textarea, select')).toHaveCount(0);
    await expect(page.locator('[data-og7="publication-advanced"]')).toHaveCount(
      0
    );
    await expect(
      page.locator('[data-og7="publication-contract-history"]')
    ).toHaveCount(0);
    await expect(page.locator('[data-og7="publication-workshop"]')).toHaveCount(
      0
    );
    await page.goto(context.path('media') + '#dossier-website-settings');
    await expect(
      page.locator('[data-og7="publication-advanced"]')
    ).toBeVisible();
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
      await page.goto(context.path('media') + '#dossier-website-settings');
      const advanced = page.locator('[data-og7="publication-advanced"]');
      if ((await advanced.getAttribute('open')) === null) {
        await advanced.locator(':scope > summary').focus();
        await page.keyboard.press('Enter');
      }
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
    await page.goto(context.path('media') + '#dossier-website-settings');
    const advanced = page.locator('[data-og7="publication-advanced"]');
    if ((await advanced.getAttribute('open')) === null)
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
