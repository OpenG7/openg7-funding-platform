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
      await expect(
        rail.locator('[data-og7="publication-next-responsibility"]')
      ).toContainText(
        locale === 'en'
          ? 'Next step: platform.'
          : 'Prochaine étape : plateforme.'
      );
      await expect(rail).not.toContainText('admin.dossier.');
      const finances = frame
        .locator('[data-og7="dossier-tabs"]')
        .getByRole('button', { name: 'Finances', exact: true });
      await expect(finances).toHaveAccessibleDescription(
        locale === 'en' ? 'Error' : 'Erreur'
      );
      const blockers = rail.locator('[data-og7="publication-blockers"]');
      await blockers.locator('summary').focus();
      await page.keyboard.press('Enter');
      await blockers.getByRole('link').press('Enter');
      await expect(page).toHaveURL(/tab=media.*#dossier-media$/);
      await expect(page.locator('#dossier-media')).toBeFocused();
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
