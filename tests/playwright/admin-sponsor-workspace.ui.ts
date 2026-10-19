import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { AdminSponsorshipProgress } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface WorkspaceTestContext {
  fixtures(
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ): Promise<{
    calls: readonly { readonly method: string; readonly url: URL }[];
    options: {
      progressOverrides: Partial<AdminSponsorshipProgress>;
      next: AdminSponsorshipProgress['next'] | null;
      milestones: AdminSponsorshipProgress['milestones'] | null;
      status: number;
    };
  }>;
  path(tab?: string, value?: string): string;
}

export function registerSponsorWorkspaceTests({
  fixtures,
  path
}: WorkspaceTestContext): void {
  test('follow-up clears a cached draft when its closed session expires', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'operator');
    await page.goto(path());
    const command = page.locator('[data-og7="interventions-toggle"]');
    await command.click();
    await page
      .locator('[data-og7="intervention-note"]')
      .fill('Synthetic private draft before expiry');
    await page.keyboard.press('Escape');
    const reads = calls.filter((call) =>
      call.url.pathname.endsWith('/interventions')
    ).length;
    await page.evaluate(() =>
      sessionStorage.setItem(
        'openg7-admin-session-expires-at',
        '2000-01-01T00:00:00Z'
      )
    );
    await command.click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(
      page.getByText('Synthetic private draft before expiry')
    ).toHaveCount(0);
    expect(
      calls.filter((call) => call.url.pathname.endsWith('/interventions'))
    ).toHaveLength(reads);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    test(`shared dossier actions expose server states and targeted corrections in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'reader');
      options.progressOverrides = {
        publicationBlockers: ['media'],
        publicationWorkflow: {
          state: 'waiting',
          responsibility: 'platform',
          reason: 'publication_scheduled',
          obligations: []
        }
      };
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path());
      if (locale === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const frame = page.locator('[data-og7="sponsorship-dossier"]');
      const rail = frame.locator('[data-og7="dossier-worklist"]');
      const recommendation = frame.locator(
        '[data-og7="dossier-recommendation"]'
      );
      await expect(recommendation).toHaveCount(1);
      await expect(rail.locator('[data-og7="dossier-next"]')).toHaveCount(1);
      await expect(
        rail.locator('[data-og7="publication-next-responsibility"]')
      ).toContainText(
        locale === 'en'
          ? 'Next step: platform.'
          : 'Prochaine étape : plateforme.'
      );
      await expect(rail).not.toContainText('admin.dossier.');
      await expect(rail).not.toContainText('admin.sponsorsCleanup.');
      const finances = frame
        .locator('[data-og7="dossier-tabs"]')
        .getByRole('button', { name: 'Finances', exact: true });
      await expect(finances).toHaveAccessibleDescription(
        locale === 'en' ? 'Error' : 'Erreur'
      );
      const blockers = rail.locator('[data-og7="publication-blockers"]');
      const media = blockers
        .locator('[data-og7="dossier-blocker-family"][data-og7-id="media"]')
        .getByRole('link');
      await media.focus();
      await media.press('Enter');
      await expect(page).toHaveURL(/tab=media.*#dossier-media$/);
      await expect(page.locator('#dossier-media')).toBeFocused();
      await expect(recommendation).toHaveCount(1);
      await expect(
        recommendation.locator('[data-og7="dossier-next"]')
      ).toHaveCount(1);
      await expect(
        recommendation.locator('[data-og7="publication-blockers"]')
      ).toHaveCount(0);
      await expect(
        recommendation.locator('[data-og7="dossier-next-owner"]')
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="sponsorship-dossier"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }

  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    test(`dossier recommendation preserves server priority and discloses additional blocker families in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'reader');
      const english = locale === 'en';
      options.next = {
        reason: 'stripe_failed',
        tab: 'overview',
        adminUrl: path() + '#dossier-stripe'
      };
      options.milestones = [
        {
          id: 'identity',
          state: 'blocked',
          reason: 'identity_missing',
          tab: 'identity'
        },
        {
          id: 'review',
          state: 'pending',
          reason: 'review_pending',
          tab: 'overview'
        },
        { id: 'media', state: 'pending', reason: 'media_review', tab: 'media' },
        {
          id: 'publication',
          state: 'pending',
          reason: 'publication_pending',
          tab: 'publication'
        }
      ];
      options.progressOverrides = {
        publicationBlockers: ['commitment_needs_confirmation'],
        publicationWorkflow: {
          state: 'action_required',
          responsibility: 'admin',
          reason: 'publication_preparation_required',
          obligations: []
        },
        failedStripeEvents: [
          { id: 'evt_synthetic_ux03', type: 'payment_intent.succeeded' }
        ]
      };
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path());
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const recommendation = page.locator(
        '[data-og7="dossier-recommendation"]'
      );
      const families = recommendation.locator(
        '[data-og7="dossier-blocker-family"]'
      );
      await expect(recommendation).toHaveCount(1);
      await expect(
        recommendation.getByText(
          english
            ? 'A Stripe event linked to this dossier failed.'
            : 'Un événement Stripe lié au dossier est en échec.',
          { exact: true }
        )
      ).toBeVisible();
      const primary = recommendation.locator('[data-og7="dossier-next"]');
      await expect(primary).toHaveText(
        english ? 'View Stripe errors' : 'Voir les erreurs Stripe'
      );
      await expect(primary).toHaveAttribute('href', path() + '#dossier-stripe');
      await expect(
        recommendation.locator('[data-og7="dossier-next-owner"]')
      ).toContainText(
        english ? 'Responsibility to be determined' : 'Responsable à déterminer'
      );
      await expect(families).toHaveCount(3);
      expect(
        await families.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-og7-id'))
        )
      ).toEqual(['identity', 'review', 'media']);
      await expect(
        families.filter({
          has: page.getByRole('heading', {
            name: english ? 'Sponsor review' : 'Revue du commanditaire',
            exact: true
          })
        })
      ).toContainText(english ? 'Pending' : 'En attente');
      const all = recommendation.locator('[data-og7="dossier-blockers-all"]');
      await expect(all).toHaveAttribute('aria-expanded', 'false');
      await all.focus();
      await all.press('Enter');
      await expect(all).toBeFocused();
      await expect(all).toHaveAttribute('aria-expanded', 'true');
      await expect(families).toHaveCount(6);
      expect(
        await families.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-og7-id'))
        )
      ).toEqual([
        'identity',
        'review',
        'media',
        'preparation',
        'publication',
        'finance'
      ]);
      for (const link of await families.getByRole('link').all()) {
        const href = await link.getAttribute('href');
        expect(href).not.toBeNull();
        const destination = new URL(href!, 'http://fixture.invalid');
        expect(destination.pathname).toBe('/admin/fundraiser/sponsors');
        expect(destination.searchParams.get('sponsorshipId')).toBe(
          new URL(path(), 'http://fixture.invalid').searchParams.get(
            'sponsorshipId'
          )
        );
        expect(destination.hash).toMatch(/^#dossier-/);
      }
      await expect(primary).toHaveAttribute('href', path() + '#dossier-stripe');
      await expect(recommendation).not.toContainText('admin.sponsorsCleanup.');
      await expect(recommendation).not.toContainText('admin.dossier.');
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="dossier-recommendation"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await all.press('Enter');
      await expect(families).toHaveCount(3);
      await primary.focus();
      await primary.press('Enter');
      await expect(page).toHaveURL(path() + '#dossier-stripe');
      await expect(page.locator('#dossier-stripe')).toBeFocused();
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }

  test('shared indicators clear when the refreshed server projection is unavailable', async ({
    page
  }) => {
    const { options } = await fixtures(page, 'reader');
    await page.goto(path());
    const states = page.locator('[data-og7="dossier-tab-state"]');
    await expect(states).not.toHaveCount(0);
    options.status = 503;
    await page.locator('[data-og7="dossier-refresh"]').click();
    await expect(
      page.locator('[data-og7="sponsorship-progress"]').getByRole('alert')
    ).toBeVisible();
    await expect(states).toHaveCount(0);
    await expect(page.locator('[data-og7="dossier-next"]')).toHaveCount(0);
    await expect(
      page.locator('[data-og7="dossier-recommendation"]')
    ).toHaveCount(0);
  });

  test('invoice inspection stays in the dossier and restores focus after an unavailable preview', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'reader');
    await page.goto(path('billing'));
    const document = page
      .locator('[data-og7="dossier-document-preview"]')
      .first();
    await document.focus();
    await document.press('Enter');
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(path('billing'));
    await page.keyboard.press('Escape');
    await expect(document).toBeFocused();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}
