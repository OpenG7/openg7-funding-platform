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
  page.locator(
    tool === 'moderation'
      ? '[data-og7="moderation-feature-toggle"]'
      : `[data-og7="dossier-tool-toggle"][data-og7-id="${tool}"]`
  );
const panel = (page: Page, tool: string) =>
  page.locator(
    tool === 'moderation'
      ? '[data-og7="moderation-feature-panel"]'
      : `[data-og7="dossier-tool-panel"][data-og7-id="${tool}"]`
  );
const visiblePanels = (page: Page) =>
  page.locator(
    '[data-og7="dossier-tool-panel"]:visible, [data-og7="moderation-feature-panel"]:visible'
  );
const writesDuring = (page: Page): string[] => {
  const writes: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && request.method() !== 'GET')
      writes.push(pathname);
  });
  return writes;
};

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
    }, testInfo) => {
      const { calls } = await fixtures(page, 'owner');
      const writes = writesDuring(page);
      await page.addInitScript((locale) => {
        localStorage.setItem('openg7.language', locale);
      }, language);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('identity'));
      await expect(page.locator('[data-og7="dossier-identity"]')).toBeVisible();
      await expect(page.locator('[data-og7="dossier-context"]')).toHaveCount(0);
      await expect(visiblePanels(page)).toHaveCount(0);
      await expect(
        page.locator(
          'openg7-admin-sponsor-detail-header [data-og7="moderation-feature-toggle"]'
        )
      ).toBeVisible();
      await expect(
        page.locator(
          '[data-og7="dossier-tool-toggle"][data-og7-id="moderation"]'
        )
      ).toHaveCount(0);

      await expect(toggle(page, 'help')).toHaveCount(0);
      await expect(page.locator('[data-og7="dossier-assistant"]')).toHaveText(
        language === 'en' ? 'Assistant & help' : 'Assistant et aide'
      );
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
            : current.locator('[data-og7="moderation-feature-close"]')
        ).toBeFocused();
        await expect(command).toHaveAttribute('aria-expanded', 'true');
        await expect(visiblePanels(page)).toHaveCount(1);
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        await expect(
          page.locator('[data-og7="dossier-identity"]')
        ).toBeVisible();
        if (tool === 'moderation') {
          const header = page.locator('[data-og7="dossier-header"]');
          const details = header.locator('details').first();
          await details.locator('summary').click();
          const detailsBox = (await details.boundingBox())!;
          const panelBox = (await current.boundingBox())!;
          expect(panelBox.y).toBeGreaterThanOrEqual(
            detailsBox.y + detailsBox.height
          );
          await details.locator('summary').click();
          await current
            .locator('[data-og7="moderation-feature-close"]')
            .focus();
          expect(
            (
              await new AxeBuilder({ page })
                .include('[data-og7="dossier-header"]')
                .analyze()
            ).violations
          ).toEqual([]);
          await header.screenshot({
            path: testInfo.outputPath('moderation-header.png'),
            animations: 'disabled'
          });
        }
        await page.keyboard.press('Escape');
        await expect(current).toBeHidden();
        await expect(command).toHaveAttribute('aria-expanded', 'false');
        await expect(command).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(current).toBeVisible();
      }

      const close = panel(page, 'access').locator(
        '[data-og7="dossier-tool-close"]'
      );
      await close.focus();
      await page.keyboard.press('Enter');
      await expect(visiblePanels(page)).toHaveCount(0);
      await expect(toggle(page, 'access')).toBeFocused();
      await toggle(page, 'access').click();
      await toggle(page, 'moderation').click();
      await expect(panel(page, 'access')).toBeHidden();
      await expect(panel(page, 'moderation')).toBeVisible();
      await expect(visiblePanels(page)).toHaveCount(1);
      await panel(page, 'moderation')
        .locator('[data-og7="moderation-feature-close"]')
        .click();
      await expect(toggle(page, 'moderation')).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
      expect(writes).toEqual([]);
    });
  }

  test('reader opens shared assistance without gaining access or moderation controls', async ({
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
    const assistance = page.locator('[data-og7="dossier-assistant"]');
    await assistance.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/assistant\?sponsorshipId=/);
    await expect(
      page.locator(
        '[data-og7="assistant-dossier-guide"] [data-og7="dossier-guide"]'
      )
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="assistant-dossier-workspace"]')
          .analyze()
      ).violations
    ).toEqual([]);
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
      await page.goto(path(tab));
      await expect(
        page.locator('[data-og7="dossier-tabs"]').getByRole('button', {
          name: title,
          exact: true
        })
      ).toHaveAttribute('aria-current', 'page');
      await expect(page.locator(section)).toBeVisible();
      await toggle(page, 'moderation').click();
      await expect(panel(page, 'moderation')).toBeVisible();
      await panel(page, 'moderation')
        .locator('[data-og7="moderation-feature-close"]')
        .click();
      await expect(page).toHaveURL(path(tab));
      await expect(page.locator(section)).toBeVisible();
    }
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('header moderation preserves its decision across tabs and resets for another dossier', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'owner');
    const writes = writesDuring(page);
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.goto(path());
    await toggle(page, 'moderation').click();
    await expect(panel(page, 'moderation')).toBeVisible();
    await expect(panel(page, 'moderation').getByRole('combobox')).toHaveValue(
      'N1'
    );
    await panel(page, 'moderation').getByRole('combobox').selectOption('N4');
    await page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await expect(page).toHaveURL(path('publication'));
    await expect(panel(page, 'moderation')).toBeVisible();
    await expect(panel(page, 'moderation').getByRole('combobox')).toHaveValue(
      'N4'
    );
    await expect(toggle(page, 'moderation')).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    await page
      .locator('[data-og7="sponsors-list"]')
      .getByRole('searchbox')
      .fill('');
    await expect(
      page.getByRole('button', { name: 'Dossier suivant', exact: true })
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Dossier suivant', exact: true })
      .click();
    await expect(page).toHaveURL(path('publication', secondId));
    await expect(
      page.locator('[data-og7="sponsorship-dossier"]')
    ).toHaveAttribute('data-og7-id', secondId);
    await expect(visiblePanels(page)).toHaveCount(0);
    await expect(toggle(page, 'moderation')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await toggle(page, 'moderation').click();
    await expect(panel(page, 'moderation').getByRole('combobox')).toHaveValue(
      'N1'
    );
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(writes).toEqual([]);
  });

  test('pending moderation content keeps its header feature busy and cancels without writing', async ({
    page
  }) => {
    await fixtures(page, 'owner');
    const writes = writesDuring(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/admin/moderation/content?*', async (route) => {
      await held;
      await route.fallback();
    });
    await page.goto(path('identity'));
    await toggle(page, 'moderation').click();
    const feature = panel(page, 'moderation');
    const examine = feature.locator('[data-og7="moderation-open"]');
    const close = feature.locator('[data-og7="moderation-feature-close"]');
    const loading = page.waitForRequest('**/api/admin/moderation/content?*');
    await examine.click();
    await loading;
    try {
      await expect(
        page.locator('[data-og7="moderation-decision"]')
      ).toBeVisible();
      await expect(close).toBeDisabled();
      await expect(toggle(page, 'moderation')).toBeDisabled();
      await expect(toggle(page, 'access')).toBeDisabled();
      await expect(feature).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(
        page.locator('[data-og7="moderation-decision"]')
      ).toHaveCount(0);
      await expect(feature).toBeVisible();
      await expect(examine).toBeFocused();
      await expect(close).toBeEnabled();
    } finally {
      release();
    }
    await close.click();
    await expect(toggle(page, 'moderation')).toBeFocused();
    expect(writes).toEqual([]);
  });

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
    await expect(toggle(page, 'moderation')).toBeDisabled();
    await expect(access).toBeVisible();
    release();
    await expect(close).toBeEnabled();
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
