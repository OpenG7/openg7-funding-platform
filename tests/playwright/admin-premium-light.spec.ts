import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';
import {
  expectAdminFontsReady,
  expectLocalAdminFonts,
  fontFamilies,
  watchFontRequests
} from './support/admin-fonts.js';
import { controllerPath } from './support/controller-journeys.fixtures.js';
import {
  premiumAppearanceKey as appearanceKey,
  premiumFixtures
} from './support/admin-premium-fixtures.js';

for (const language of ['fr-CA', 'en'] as const) {
  for (const viewport of [
    { width: 390, height: 1000 },
    // A 1920x1080 display at 125% supplies 1536x864 CSS pixels.
    { width: 1536, height: 864 }
  ]) {
    test(`Premium Light preserves contrast and controls in ${language} at ${viewport.width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const fontRequests = watchFontRequests(page);
      const { state, gate, writes } = await premiumFixtures(page, language);
      await page.goto('/admin/fundraiser');
      const shell = page.locator('openg7-admin-layout');
      const dashboard = page.locator('[data-og7="admin-dashboard"]');
      const refresh = dashboard.locator('[data-og7="dashboard-refresh"]');
      await expect(refresh).toBeEnabled();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        'mineral'
      );
      await expect(shell).toHaveCSS('background-color', 'rgb(245, 247, 251)');
      await expect(shell).toHaveCSS('color', 'rgb(23, 43, 80)');
      await expect(shell).toHaveCSS('line-height', '24.8px');
      const heading = dashboard.getByRole('heading', { level: 1 });
      await expect
        .poll(async () =>
          fontFamilies(
            await heading.evaluate(
              (element) => getComputedStyle(element).fontFamily
            )
          ).slice(0, 2)
        )
        .toEqual(['Sora', 'Inter']);
      await expectAdminFontsReady(page);
      expect(
        fontFamilies(
          await shell.evaluate(
            (element) => getComputedStyle(element).fontFamily
          )
        )[0]
      ).toBe('Inter');
      await expect(heading).toHaveCSS('font-weight', '600');
      const title = await heading.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          size: Number.parseFloat(style.fontSize),
          tracking: Number.parseFloat(style.letterSpacing)
        };
      });
      expect(title.size).toBeGreaterThanOrEqual(26);
      expect(title.size).toBeLessThanOrEqual(30);
      expect(title.tracking).toBeCloseTo(title.size * -0.02, 3);
      const summaries = dashboard.getByRole('region', {
        name:
          language === 'en' ? 'Operations summary' : 'Synthèse des opérations'
      });
      const panel = summaries.getByRole('article').first();
      await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(panel).toHaveCSS('background-image', 'none');
      await expect(panel).toHaveCSS('border-color', 'rgb(216, 224, 236)');
      await expect(panel).toHaveCSS('border-radius', '14px');
      await expect(panel.locator('header')).toHaveCSS('padding', '20px');
      await expect(refresh).toHaveCSS('border-radius', '10px');
      await expect(refresh).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      if (viewport.width === 1536) {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await expect(refresh).toHaveCSS('transition-duration', /0\.16s/);
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
      await refresh.hover();
      await expect(refresh).toHaveCSS('background-color', 'rgb(240, 244, 249)');
      await page.keyboard.press('Tab');
      await refresh.focus();
      await expect(refresh).toBeFocused();
      await expect(refresh).toHaveCSS('outline-width', '3px');
      await expect(refresh).toHaveCSS('outline-style', 'solid');
      await expect(refresh).toHaveCSS('outline-color', 'rgb(53, 106, 159)');
      await expect(refresh).toHaveCSS('outline-offset', '3px');
      expect(
        await refresh.evaluate((element) =>
          getComputedStyle(element)
            .transitionDuration.split(',')
            .every((duration) => Number.parseFloat(duration) <= 0.00001)
        )
      ).toBe(true);

      let release!: () => void;
      gate.next = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await refresh.click();
        await expect(refresh).toBeDisabled();
        await refresh.hover({ force: true });
        await expect(refresh).toHaveCSS('cursor', 'not-allowed');
        await expect(refresh).toHaveCSS(
          'background-color',
          'rgb(240, 244, 249)'
        );
        await expect(refresh).toHaveCSS('color', 'rgb(82, 98, 123)');
        await expect(refresh).toHaveCSS('opacity', '0.65');
        await expect(refresh).toHaveCSS('box-shadow', 'none');
      } finally {
        gate.next = null;
        release();
      }
      await expect(refresh).toBeEnabled();
      const dashboardContrast = await new AxeBuilder({ page })
        .include('[data-og7="admin-dashboard"]')
        .withRules(['color-contrast'])
        .analyze();
      expect(dashboardContrast.violations).toEqual([]);
      expect(
        dashboardContrast.passes.some((rule) => rule.id === 'color-contrast')
      ).toBe(true);
      await page.mouse.move(0, 0);
      await heading.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`premium-dashboard-${viewport.width}.png`),
        animations: 'disabled'
      });
      await page.reload();
      await expect(refresh).toBeEnabled();
      await expectAdminFontsReady(page);
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        'mineral'
      );
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).theme,
          appearanceKey
        )
      ).toBe('mineral');

      await page.goto(controllerPath('identity'));
      const dossier = page.locator('[data-og7="sponsorship-dossier"]');
      await expect(
        dossier.getByRole('heading', { name: 'Xbox fixture', exact: true })
      ).toBeVisible();
      await expectAdminFontsReady(page);
      await expect(dossier).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(dossier).toHaveCSS('border-radius', '14px');
      const moderationSelect = dossier
        .locator('[data-og7="moderation-actions"]')
        .getByRole('combobox')
        .first();
      await expect(moderationSelect).toHaveCSS('min-height', '44px');
      await expect(moderationSelect).toHaveCSS('padding', '10px 12px');
      await expect(moderationSelect).toHaveCSS('border-radius', '10px');
      await page.keyboard.press('Tab');
      await moderationSelect.focus();
      await expect(moderationSelect).toHaveCSS(
        'outline',
        'rgb(53, 106, 159) solid 3px'
      );
      const tabs = page.locator('[data-og7="dossier-tabs"]');
      await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
      const activeNavigation = page.locator(
        '#admin-sidebar nav a[aria-current="page"]'
      );
      await expect(activeNavigation).toHaveCSS(
        'background-color',
        'rgb(237, 243, 250)'
      );
      await expect(activeNavigation).toHaveCSS('color', 'rgb(54, 93, 136)');
      const opener = page.locator('[data-og7="edit-dossier"]');
      await opener.focus();
      await page.keyboard.press('Enter');
      const form = page.locator('[data-og7="edit-dossier-form"]');
      const company = form.locator('input[name="companyName"]');
      const save = form.locator('button[type="submit"]');
      await expect(save).toBeDisabled();
      await expect(save).toHaveCSS('background-color', 'rgb(240, 244, 249)');
      await company.fill('Synthetic unsaved premium draft');
      await expect(save).toBeEnabled();
      await expect(save).toHaveCSS('background-color', 'rgb(237, 202, 114)');
      await expect(save).toHaveCSS('background-image', 'none');
      await expect(save).toHaveCSS('color', 'rgb(37, 34, 15)');
      await save.hover();
      await expect(save).toHaveCSS('background-color', 'rgb(237, 202, 114)');
      await expect(save).toHaveCSS('color', 'rgb(37, 34, 15)');
      await page.keyboard.press('Tab');
      await company.focus();
      await expect(company).toHaveCSS('outline-width', '3px');
      await expect(company).toHaveCSS('outline-offset', '3px');
      await expect(company).toHaveCSS('outline-color', 'rgb(53, 106, 159)');
      const controlsContrast = await new AxeBuilder({ page })
        .include('[data-og7="edit-dossier-form"]')
        .include('[data-og7="moderation-actions"]')
        .withRules(['color-contrast'])
        .analyze();
      expect(controlsContrast.violations).toEqual([]);
      expect(
        controlsContrast.passes.some((rule) => rule.id === 'color-contrast')
      ).toBe(true);
      await page.keyboard.press('Escape');
      await expect(form).toHaveCount(0);
      await expect(opener).toBeFocused();
      await page.mouse.move(0, 0);
      await dossier
        .getByRole('heading', { name: 'Xbox fixture', exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`premium-dossier-${viewport.width}.png`),
        animations: 'disabled'
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(writes).toEqual([]);
      expect(state.commands).toEqual([]);
      expectLocalAdminFonts(fontRequests, page.url());
    });
  }
}

for (const { language, width } of [
  { language: 'fr-CA', width: 390 },
  { language: 'en', width: 1536 }
]) {
  test(`admin font failures retain readable fallback and keyboard controls in ${language}`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1536 ? 864 : 1000 });
    const fontRequests = watchFontRequests(page);
    const { writes, state } = await premiumFixtures(page, language);
    await page.route(/\.woff2(?:\?|$)/, (route) => route.abort('failed'));
    await page.goto('/admin/fundraiser');
    const dashboard = page.locator('[data-og7="admin-dashboard"]');
    const heading = dashboard.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return Array.from(document.fonts, (face) => ({
        family: face.family.replace(/^['"]|['"]$/g, ''),
        status: face.status
      }));
    });
    for (const family of ['Inter', 'Sora']) {
      expect(
        fonts.some((face) => face.family === family && face.status === 'error')
      ).toBe(true);
      expect(
        fonts.some((face) => face.family === family && face.status === 'loaded')
      ).toBe(false);
    }
    const fallback = await heading.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        family: style.fontFamily,
        size: Number.parseFloat(style.fontSize),
        width: rect.width,
        height: rect.height
      };
    });
    expect(fontFamilies(fallback.family)).toContain('Segoe UI');
    expect(fallback.size).toBeGreaterThanOrEqual(26);
    expect(fallback.height).toBeGreaterThanOrEqual(26);
    expect(fallback.width).toBeGreaterThan(0);
    const refresh = dashboard.locator('[data-og7="dashboard-refresh"]');
    await expect(refresh).toBeEnabled();
    await page.keyboard.press('Tab');
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await expect(refresh).toHaveCSS('outline-width', '3px');
    const accessibility = await new AxeBuilder({ page })
      .include('[data-og7="admin-dashboard"]')
      .withRules(['color-contrast', 'button-name', 'label', 'link-name'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    expectLocalAdminFonts(fontRequests, page.url());
    expect(writes).toEqual([]);
    expect(state.commands).toEqual([]);
    await heading.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`premium-font-fallback-${width}.png`)
    });
  });
}

test.describe('Public prerendering', () => {
  test.use({ javaScriptEnabled: false });

  test('Premium Light leaves public SSR readable without JavaScript', async ({
    page
  }) => {
    const fontRequests = watchFontRequests(page);
    // Administrative routes are client-rendered by the built-Web server;
    // exercise public prerendering through the normal isolated page fixture.
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 503, json: {} })
    );
    for (const [path, language] of [
      ['/fonds-des-batisseurs', 'fr-CA'],
      ['/en/fonds-des-batisseurs', 'en']
    ]) {
      expect((await page.goto(path))?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        'rgb(247, 245, 240)'
      );
      await expect(page.locator('body')).toHaveCSS('color', 'rgb(41, 51, 46)');
      expect(
        fontFamilies(
          await page
            .locator('body')
            .evaluate((element) => getComputedStyle(element).fontFamily)
        )[0]
      ).toBe('Segoe UI');
      expect(
        await page.evaluate(() =>
          Array.from(document.fonts, (face) =>
            face.family.replace(/^['"]|['"]$/g, '')
          ).filter((family) => family === 'Inter' || family === 'Sora')
        )
      ).toEqual([]);
    }
    expect(fontRequests.filter((url) => /inter|sora/i.test(url))).toEqual([]);
  });
});
