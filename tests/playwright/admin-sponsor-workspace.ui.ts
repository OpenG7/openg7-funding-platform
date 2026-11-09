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
    ['fr-CA', 1536],
    ['fr-CA', 3840],
    ['en', 390]
  ] as const) {
    test(`overview is limited to six statistics, one priority and five domains in ${locale} at ${width}px`, async ({
      page
    }, testInfo) => {
      const { calls, options } = await fixtures(page, 'operator');
      options.next = {
        reason: 'identity_missing',
        tab: 'identity',
        adminUrl: path('identity')
      };
      options.milestones = [
        {
          id: 'payment',
          state: 'complete',
          reason: 'payment_recorded',
          tab: 'overview'
        },
        {
          id: 'identity',
          state: 'blocked',
          reason: 'identity_missing',
          tab: 'identity'
        },
        { id: 'media', state: 'pending', reason: 'media_review', tab: 'media' },
        {
          id: 'review',
          state: 'pending',
          reason: 'review_pending',
          tab: 'overview'
        },
        {
          id: 'billing',
          state: 'complete',
          reason: 'invoice_issued',
          tab: 'billing'
        },
        {
          id: 'publication',
          state: 'blocked',
          reason: 'publication_blocked',
          tab: 'publication'
        }
      ];
      options.progressOverrides = {
        publicationBlockers: ['identity', 'review', 'media'],
        publicationWorkflow: {
          state: 'blocked',
          reason: 'publication_blocked',
          responsibility: 'admin',
          obligations: []
        },
        website: {
          visible: false,
          held: false,
          canPublish: false,
          version: 'fixture-hidden',
          blockers: ['identity', 'review', 'media']
        },
        refund: {
          workflow: 'none',
          state: 'not_required',
          confirmedAmountMinor: 0,
          creditMissing: false,
          hasError: false
        },
        failedEmails: [],
        failedStripeEvents: []
      };
      await page.addInitScript(
        (value) => localStorage.setItem('openg7.language', value),
        locale
      );
      await page.setViewportSize({
        width,
        height: width === 3840 ? 2160 : 900
      });
      await page.goto(path());
      const overview = page.locator('openg7-admin-sponsor-detail-overview');
      const stats = overview.locator('[data-og7="overview-stat"]');
      await expect(stats).toHaveCount(6);
      expect(
        await stats.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-og7-id'))
        )
      ).toEqual([
        'steps',
        'services',
        'blockers',
        'visibility',
        'media',
        'proposals'
      ]);
      const positions = await stats.evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { left: Math.round(bounds.left), top: Math.round(bounds.top) };
        })
      );
      if (width >= 1536) {
        expect(
          new Set(positions.slice(0, 3).map((position) => position.top)).size
        ).toBe(1);
        expect(
          new Set(positions.slice(3).map((position) => position.top)).size
        ).toBe(1);
        expect(positions[3]!.top).toBeGreaterThan(positions[0]!.top);
        expect(
          new Set(positions.slice(0, 3).map((position) => position.left)).size
        ).toBe(3);
        expect(positions.slice(0, 3).map((position) => position.left)).toEqual(
          positions.slice(3).map((position) => position.left)
        );
      } else {
        expect(new Set(positions.map((position) => position.top)).size).toBe(6);
        expect(new Set(positions.map((position) => position.left)).size).toBe(
          1
        );
      }
      await expect(
        overview.locator('[data-og7="overview-stat"][data-og7-id="steps"]')
      ).toContainText(/2\s*\/\s*6/);
      await expect(
        overview.locator('[data-og7="overview-stat"][data-og7-id="visibility"]')
      ).toContainText(locale === 'en' ? 'Hidden' : 'Masquée');
      await expect(
        overview.locator('[data-og7="overview-stat"][data-og7-id="blockers"]')
      ).toContainText('3');
      await expect(
        overview.locator('[data-og7="overview-stat"][data-og7-id="proposals"]')
      ).toContainText(/Indisponible|Unavailable/);
      await expect(
        overview.locator('[data-og7="overview-priority"]')
      ).toHaveCount(1);
      const primary = overview.locator('[data-og7="overview-priority-action"]');
      await expect(primary).toHaveCount(1);
      const domains = overview.locator('[data-og7="overview-domain"]');
      await expect(domains).toHaveCount(5);
      expect(
        await domains.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-og7-id'))
        )
      ).toEqual(['identity', 'media', 'publication', 'review', 'finance']);
      for (const hook of [
        'dossier-actions',
        'dossier-worklist',
        'dossier-service-summary',
        'publication-blockers',
        'dossier-overview-summary'
      ])
        await expect(page.locator(`[data-og7="${hook}"]`)).toHaveCount(0);
      await expect(overview.locator('textarea, input, details')).toHaveCount(0);
      await expect(overview).not.toContainText('admin.dossier.');
      await expect(overview).not.toContainText('admin.sponsorsCleanup.');
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
      if (width === 3840) {
        await page.screenshot({
          path: testInfo.outputPath('overview-dashboard-fr-4k.png'),
          animations: 'disabled'
        });
      }
      await primary.focus();
      await primary.press('Enter');
      await expect(page).toHaveURL(/tab=identity.*#dossier-identity$/);
      await expect(page.locator('#dossier-identity')).toBeFocused();
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`overview domain rows navigate directly without duplicate shortcuts in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls } = await fixtures(page, 'reader');
      await page.addInitScript(
        (value) => localStorage.setItem('openg7.language', value),
        locale
      );
      await page.setViewportSize({
        width,
        height: width === 3840 ? 2160 : 900
      });
      await page.goto(path());
      const overview = page.locator('openg7-admin-sponsor-detail-overview');
      await expect(
        overview.locator('[data-og7="overview-priority-action"]')
      ).toHaveCount(0);
      const media = overview.locator(
        '[data-og7="overview-domain"][data-og7-id="media"]'
      );
      await media.getByRole('button').focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/tab=media.*#dossier-media$/);
      await expect(page.locator('#dossier-media')).toBeFocused();
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
    await expect(
      page.locator('[data-og7="overview-priority-action"]')
    ).toHaveCount(0);
    for (const id of ['steps', 'services', 'blockers', 'visibility'])
      await expect(
        page.locator(`[data-og7="overview-stat"][data-og7-id="${id}"]`)
      ).toContainText(/Indisponible|Unavailable/);
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
