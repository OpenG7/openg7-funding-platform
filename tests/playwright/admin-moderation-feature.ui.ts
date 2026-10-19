import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';

interface ModerationFeatureTestContext {
  fixtures(
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ): Promise<{
    calls: readonly { readonly method: string; readonly url: URL }[];
  }>;
  path(tab?: string, value?: string): string;
  secondId: string;
}

const toggle = (page: Page) =>
  page.locator('[data-og7="moderation-feature-toggle"]');
const panel = (page: Page) =>
  page.locator('[data-og7="moderation-feature-panel"]');
const writesDuring = (page: Page): string[] => {
  const writes: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && request.method() !== 'GET')
      writes.push(pathname);
  });
  return writes;
};

export function registerModerationFeatureTests({
  fixtures,
  path,
  secondId
}: ModerationFeatureTestContext): void {
  for (const [language, width] of [
    ['fr-CA', 1536],
    ['en', 390]
  ] as const) {
    test(`header moderation opens with N1 and restores keyboard focus in ${language} at ${width}px`, async ({
      page
    }) => {
      const { calls } = await fixtures(page, 'operator');
      const writes = writesDuring(page);
      await page.addInitScript((locale) => {
        localStorage.setItem('openg7.language', locale);
      }, language);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('identity'));
      const header = page.locator('[data-og7="dossier-header"]');
      const command = toggle(page);
      const feature = panel(page);
      await expect(
        header.locator('[data-og7="moderation-feature-toggle"]')
      ).toBeVisible();
      await expect(command).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('[data-og7="moderation-actions"]')).toHaveCount(
        0
      );
      await command.focus();
      await page.keyboard.press('Enter');
      await expect(feature).toBeVisible();
      await expect(command).toHaveAttribute('aria-expanded', 'true');
      await expect(feature.getByRole('combobox')).toHaveValue('N1');
      const close = feature.locator('[data-og7="moderation-feature-close"]');
      await expect(close).toBeFocused();
      const details = header.locator('details').first();
      await details.locator('summary').click();
      const detailsBox = (await details.boundingBox())!;
      const featureBox = (await feature.boundingBox())!;
      expect(featureBox.y).toBeGreaterThanOrEqual(
        detailsBox.y + detailsBox.height
      );
      await details.locator('summary').click();
      await close.focus();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="dossier-header"]')
            .analyze()
        ).violations
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(feature).toBeHidden();
      await expect(command).toHaveAttribute('aria-expanded', 'false');
      await expect(command).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(feature).toBeVisible();
      await close.click();
      await expect(feature).toBeHidden();
      await expect(command).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
      expect(writes).toEqual([]);
    });
  }

  test('header moderation preserves its decision across tabs and resets for another dossier', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'owner');
    const writes = writesDuring(page);
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.goto(path());
    await toggle(page).click();
    const feature = panel(page);
    await expect(feature.getByRole('combobox')).toHaveValue('N1');
    await feature.getByRole('combobox').selectOption('N4');
    await page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await expect(page).toHaveURL(path('publication'));
    await expect(feature).toBeVisible();
    await expect(feature.getByRole('combobox')).toHaveValue('N4');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await page
      .locator('[data-og7="sponsors-list"]')
      .getByRole('searchbox')
      .fill('');
    const next = page.getByRole('button', {
      name: 'Dossier suivant',
      exact: true
    });
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page).toHaveURL(path('publication', secondId));
    await expect(
      page.locator('[data-og7="sponsorship-dossier"]')
    ).toHaveAttribute('data-og7-id', secondId);
    await expect(feature).toBeHidden();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await toggle(page).click();
    await expect(feature.getByRole('combobox')).toHaveValue('N1');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(writes).toEqual([]);
  });

  test('pending moderation content keeps its header feature busy and cancels without writing', async ({
    page
  }) => {
    await fixtures(page, 'operator');
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
    await toggle(page).click();
    const feature = panel(page);
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
      await expect(toggle(page)).toBeDisabled();
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
    await expect(toggle(page)).toBeFocused();
    expect(writes).toEqual([]);
  });

  test('reader has no header moderation entry or mounted actions', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'reader');
    const writes = writesDuring(page);
    const moderationReads: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/admin/moderation/'))
        moderationReads.push(request.url());
    });
    await page.goto(path());
    await expect(page.locator('[data-og7="dossier-header"]')).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-og7="moderation-actions"]')).toHaveCount(
      0
    );
    expect(moderationReads).toEqual([]);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(writes).toEqual([]);
  });
}
