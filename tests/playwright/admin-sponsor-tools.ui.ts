import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';

interface SponsorToolTestContext {
  fixtures(
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ): Promise<{
    calls: readonly { readonly method: string; readonly url: URL }[];
  }>;
  path(tab?: string, value?: string): string;
  secondId: string;
}

const toggle = (page: Page, tool: string) =>
  page.locator(`[data-og7="dossier-tool-toggle"][data-og7-id="${tool}"]`);
const panel = (page: Page, tool: string) =>
  page.locator(`[data-og7="dossier-tool-panel"][data-og7-id="${tool}"]`);
const assistance = (page: Page) =>
  page.locator('[data-og7="dossier-assistant"]');

async function openDossierAssistance(
  page: Page,
  origin: string
): Promise<void> {
  const sponsorshipId = new URL(origin, page.url()).searchParams.get(
    'sponsorshipId'
  );
  await assistance(page).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/admin/fundraiser/assistant' &&
      url.searchParams.size === 2 &&
      url.searchParams.get('sponsorshipId') === sponsorshipId &&
      url.searchParams.get('returnTo') === origin &&
      url.hash === ''
  );
  await expect(page.locator('[data-og7="dossier-guide"]')).toBeVisible();
}

async function returnToDossier(page: Page, origin: string): Promise<void> {
  const back = page.locator('[data-og7="assistant-dossier-return"]');
  await expect(back).toHaveAttribute('href', origin);
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(origin);
  await expect(assistance(page)).toBeFocused();
}

/** Uses the existing dossier fixtures; opening tools never authorizes a write. */
export function registerSponsorToolTests({
  fixtures,
  path,
  secondId
}: SponsorToolTestContext): void {
  for (const [language, width] of [
    ['fr-CA', 1536],
    ['en', 390]
  ] as const) {
    test(`dossier tools open one nonmodal panel and restore keyboard focus in ${language} at ${width}px`, async ({
      page
    }) => {
      const { calls } = await fixtures(page, 'owner');
      await page.addInitScript((locale) => {
        localStorage.setItem('openg7.language', locale);
      }, language);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('identity'));
      await expect(page.locator('[data-og7="dossier-identity"]')).toBeVisible();
      await expect(page.locator('[data-og7="dossier-context"]')).toHaveCount(0);
      await expect(
        page.locator('[data-og7="dossier-tool-panel"]:visible')
      ).toHaveCount(0);
      await expect(toggle(page, 'help')).toHaveCount(0);
      await openDossierAssistance(page, path('identity'));
      await returnToDossier(page, path('identity'));

      for (const tool of ['moderation', 'access']) {
        const command = toggle(page, tool);
        await expect(command).toHaveAttribute('aria-expanded', 'false');
        await command.focus();
        await page.keyboard.press('Enter');
        const current = panel(page, tool);
        await expect(current).toBeVisible();
        await expect(
          tool === 'access'
            ? current
                .locator('[data-og7="admin-followup-access"]')
                .getByRole('button')
            : current.locator('[data-og7="dossier-tool-close"]')
        ).toBeFocused();
        await expect(command).toHaveAttribute('aria-expanded', 'true');
        await expect(
          page.locator('[data-og7="dossier-tool-panel"]:visible')
        ).toHaveCount(1);
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        await expect(
          page.locator('[data-og7="dossier-identity"]')
        ).toBeVisible();
      }

      const close = panel(page, 'access').locator(
        '[data-og7="dossier-tool-close"]'
      );
      await close.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.locator('[data-og7="dossier-tool-panel"]:visible')
      ).toHaveCount(0);
      await expect(toggle(page, 'access')).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }

  test('reader can open dossier help without gaining access or moderation controls', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'reader');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path());
    await expect(
      page.locator('[data-og7="dossier-overview-summary"]')
    ).toBeVisible();
    await expect(toggle(page, 'moderation')).toHaveCount(0);
    await expect(toggle(page, 'access')).toHaveCount(0);
    await expect(page.locator('[data-og7="moderation-actions"]')).toHaveCount(
      0
    );
    await expect(
      page.locator('[data-og7="admin-followup-access"]')
    ).toHaveCount(0);

    await expect(toggle(page, 'help')).toHaveCount(0);
    await openDossierAssistance(page, path());
    await expect(page.locator('[data-og7="guide-edit-identity"]')).toHaveCount(
      0
    );
    await expect(
      page.locator('[data-og7="guide-followup-access"]')
    ).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="assistant-dossier-workspace"]')
          .analyze()
      ).violations
    ).toEqual([]);
    await returnToDossier(page, path());
    await expect(toggle(page, 'moderation')).toHaveCount(0);
    await expect(toggle(page, 'access')).toHaveCount(0);
    expect(
      calls.some((call) =>
        call.url.pathname.startsWith('/api/admin/moderation/')
      )
    ).toBe(false);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('optional dossier tools preserve the legacy media and refund routes without mutations', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'owner');
    for (const [tab, title, section] of [
      ['media', 'Fiche et médias', '#dossier-media'],
      ['refund', 'Finances', '#dossier-refund']
    ]) {
      const origin = path(tab) + section;
      await page.goto(origin);
      await expect(
        page.locator('[data-og7="dossier-tabs"]').getByRole('button', {
          name: title,
          exact: true
        })
      ).toHaveAttribute('aria-current', 'page');
      await expect(page.locator(section)).toBeVisible();
      await openDossierAssistance(page, origin);
      await returnToDossier(page, origin);
      await expect(page.locator(section)).toBeVisible();
    }
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('changing a dossier tab or selected sponsorship closes its optional tool', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'owner');
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.goto(path());
    await toggle(page, 'moderation').click();
    await expect(panel(page, 'moderation')).toBeVisible();
    await page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await expect(page).toHaveURL(path('publication'));
    await expect(
      page.locator('[data-og7="dossier-tool-panel"]:visible')
    ).toHaveCount(0);
    await expect(toggle(page, 'moderation')).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    await page
      .locator('[data-og7="sponsors-list"]')
      .getByRole('searchbox')
      .fill('');
    await expect(
      page.getByRole('button', { name: 'Dossier suivant', exact: true })
    ).toBeEnabled();
    await toggle(page, 'moderation').click();
    await expect(panel(page, 'moderation')).toBeVisible();
    await page
      .getByRole('button', { name: 'Dossier suivant', exact: true })
      .click();
    await expect(page).toHaveURL(path('publication', secondId));
    await expect(
      page.locator('[data-og7="sponsorship-dossier"]')
    ).toHaveAttribute('data-og7-id', secondId);
    await expect(
      page.locator('[data-og7="dossier-tool-panel"]:visible')
    ).toHaveCount(0);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  for (const replaceSession of [false, true]) {
    test(`moderation ${replaceSession ? 'clears its previous session' : 'preserves the same session'} when revisiting a dossier tool`, async ({
      page
    }) => {
      await fixtures(page, 'operator');
      let sessionId = 'synthetic-original-session';
      let identityReads = 0;
      let historyReads = 0;
      const mutations: string[] = [];
      await page.route('**/api/admin/auth/current', async (route) => {
        identityReads++;
        await route.fulfill({
          json: {
            id: 'synthetic-moderator',
            sessionId,
            displayName: 'Synthetic moderator',
            role: 'operator',
            expiresAt: '2099-01-01T00:00:00Z'
          }
        });
      });
      await page.route('**/api/admin/moderation/**', async (route) => {
        if (route.request().method() !== 'GET')
          mutations.push(route.request().method());
        if (new URL(route.request().url()).pathname.endsWith('/decisions')) {
          historyReads++;
          return route.fulfill({
            json: {
              items: [
                {
                  id: 'synthetic-history-decision',
                  level: 'N1',
                  primaryReason: null,
                  sponsorExplanation:
                    'Synthetic history from the original session',
                  policyVersion: '1.0',
                  contentVersion: 1,
                  createdAt: '2026-10-19T12:00:00Z'
                }
              ]
            }
          });
        }
        await route.fallback();
      });
      await page.goto(path());
      await toggle(page, 'moderation').click();
      const actions = page.locator('[data-og7="moderation-actions"]');
      await expect(actions.getByRole('combobox')).toHaveValue('N1');
      await actions.getByRole('combobox').selectOption('N4');
      await actions.locator('summary').click();
      await expect(
        actions.locator('[data-og7="moderation-history-decision"]')
      ).toContainText('Synthetic history from the original session');
      expect(historyReads).toBe(1);
      const previousIdentityReads = identityReads;
      if (replaceSession) sessionId = 'synthetic-replacement-session';
      await page
        .locator('[data-og7="dossier-tabs"]')
        .getByRole('button', { name: 'Publication', exact: true })
        .click();
      await expect(page).toHaveURL(path('publication'));
      await expect
        .poll(() => identityReads)
        .toBeGreaterThan(previousIdentityReads);
      await expect(toggle(page, 'moderation')).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      await toggle(page, 'moderation').click();
      await expect(actions.getByRole('combobox')).toHaveValue(
        replaceSession ? 'N1' : 'N4'
      );
      await expect(
        actions.locator('[data-og7="moderation-history-decision"]')
      ).toHaveCount(replaceSession ? 0 : 1);
      expect(historyReads).toBe(1);
      expect(mutations).toEqual([]);
    });
  }

  test('pending access recipient verification keeps its tool open until the request settles', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'owner');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      '**/api/admin/sponsorships/followup-access?*',
      async (route) => {
        await held;
        await route.fulfill({ json: { recipient: null } });
      }
    );
    await page.goto(path('identity'));
    await toggle(page, 'access').click();
    const access = panel(page, 'access');
    await expect(
      access.locator('[data-og7="admin-followup-access"]').getByRole('button')
    ).toBeFocused();
    const verification = page.waitForRequest(
      '**/api/admin/sponsorships/followup-access?*'
    );
    await access
      .locator('[data-og7="admin-followup-access"]')
      .getByRole('button')
      .click();
    await verification;
    const close = access.locator('[data-og7="dossier-tool-close"]');
    await expect(close).toBeDisabled();
    await expect(toggle(page, 'access')).toBeDisabled();
    await expect(assistance(page)).toHaveAttribute('aria-disabled', 'true');
    const originalUrl = page.url();
    await assistance(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(originalUrl);
    await expect(access).toBeVisible();
    release();
    await expect(close).toBeEnabled();
    await expect(assistance(page)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await close.click();
    await expect(toggle(page, 'access')).toBeFocused();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('disabled access sends focus to its close control while the dossier refresh is pending', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'owner');
    await page.goto(path('identity'));
    await expect(page.locator('[data-og7="dossier-identity"]')).toBeVisible();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/admin/sponsorships?*', async (route) => {
      await held;
      await route.fallback();
    });
    const refreshing = page.waitForRequest('**/api/admin/sponsorships?*');
    await page.locator('[data-og7="dossier-refresh"]').click();
    await refreshing;
    const access = page.locator('[data-og7="admin-followup-access"]');
    try {
      await toggle(page, 'access').focus();
      await page.keyboard.press('Enter');
      await expect(panel(page, 'access')).toBeVisible();
      await expect(access.getByRole('button')).toBeDisabled();
      await expect(
        panel(page, 'access').locator('[data-og7="dossier-tool-close"]')
      ).toBeFocused();
    } finally {
      release();
    }
    await expect(access.getByRole('button')).toBeEnabled();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('an uncertain access resend keeps its request identifier after closing tools and changing tabs', async ({
    page
  }) => {
    await fixtures(page, 'owner');
    const requests: Record<string, unknown>[] = [];
    await page.route(
      '**/api/admin/sponsorships/followup-access',
      async (route) => {
        requests.push(
          route.request().postDataJSON() as Record<string, unknown>
        );
        if (requests.length === 1) return route.abort('failed');
        return route.fulfill({ json: { status: 'already_queued' } });
      }
    );
    await page.goto(path('identity'));
    await toggle(page, 'access').click();
    const access = page.locator('[data-og7="admin-followup-access"]');
    await access.getByRole('button').click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(access).toContainText('Le lien n’a pas pu être mis en file');
    expect(requests).toHaveLength(1);
    await panel(page, 'access')
      .locator('[data-og7="dossier-tool-close"]')
      .click();
    await expect(access).toBeHidden();
    await toggle(page, 'moderation').click();
    await expect(panel(page, 'moderation')).toBeVisible();
    await page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Finances', exact: true })
      .click();
    await toggle(page, 'access').click();
    await expect(access).toContainText('Le lien n’a pas pu être mis en file');
    await access.getByRole('button').click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(access).toContainText(
      'Un lien récent est déjà en file d’envoi'
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });

  test('a follow-up shortcut keeps an already opened access tool visible and focused', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'owner');
    await page.goto(path('identity'));
    await toggle(page, 'access').click();
    const access = page.locator('[data-og7="admin-followup-access"]');
    await expect(access.getByRole('button')).toBeFocused();
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('[data-og7="interventions-toggle"]').click();
      await page.locator('[data-og7="interventions-access"]').click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(panel(page, 'access')).toBeVisible();
      await expect(access.getByRole('button')).toBeFocused();
    }
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}
