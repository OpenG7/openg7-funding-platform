import { test, expect } from '../support/test.js';

import {
  area,
  createMediaWorkspaceFixture,
  type MediaWorkspaceTestContext
} from './fixture.js';

export function registerMediaWorkspaceDecisionTests(
  context: MediaWorkspaceTestContext
): void {
  const fixture = createMediaWorkspaceFixture(context);
  for (const [language, width] of [
    ['fr-CA', 1440],
    ['en', 390]
  ] as const) {
    test(`media workspace pages 100 files with one inspector and bounded private thumbnails ${language}`, async ({
      page
    }, info) => {
      const { calls } = await fixture(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(context.path('media'));
      if (language === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      await expect(area(page).locator('[data-og7="media-tile"]')).toHaveCount(
        25
      );
      await expect(
        area(page).locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      await expect(
        area(page).locator('[data-og7="media-inspector"]')
      ).toHaveCount(1);
      await area(page)
        .locator('[data-og7="media-tile"]')
        .first()
        .getByRole('button')
        .click();
      await expect(
        area(page).locator('[data-og7="media-full-preview"] img')
      ).toBeVisible();
      await expect(
        area(page).locator('[data-og7="media-inspector-alt"]')
      ).toHaveValue('Vue synthétique 1');
      expect(calls.maxActive).toBeLessThanOrEqual(4);
      expect(calls.thumbnails.length).toBeLessThanOrEqual(25);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await area(page).screenshot({
        path: info.outputPath(`media-workspace-${language}-${width}.png`)
      });
      await area(page).evaluate((element) =>
        element.scrollIntoView({ block: 'start', behavior: 'instant' })
      );
      await page.screenshot({
        path: info.outputPath(
          `media-workspace-viewport-${language}-${width}.png`
        )
      });
      await area(page).locator('[data-og7="media-next-page"]').click();
      await expect(
        area(page).locator('[data-og7="media-tile"]').first()
      ).toContainText('photo-026.webp');
      await area(page).locator('[data-og7="media-search"]').fill('photo-100');
      await expect(area(page).locator('[data-og7="media-tile"]')).toHaveCount(
        1
      );
      await area(page)
        .locator('[data-og7="media-tile"]')
        .getByRole('button')
        .click();
      await expect(
        area(page).locator('[data-og7="media-inspector-approve"]')
      ).toBeDisabled();
    });
  }

  test('media workspace confirms one exact manifest for a multi-file human decision without publishing', async ({
    page
  }) => {
    const { calls } = await fixture(page);
    await page.goto(context.path('media'));
    const tiles = area(page).locator('[data-og7="media-tile"]');
    await tiles.nth(0).getByRole('checkbox').check();
    await tiles.nth(1).getByRole('checkbox').check();
    await tiles.nth(0).getByRole('button').click();
    await area(page)
      .locator('[data-og7="media-inspector-alt"]')
      .fill('Exact human alternative text');
    await area(page).locator('[data-og7="media-batch-approve"]').click();
    await expect(
      page.locator('[data-og7="media-batch-manifest"]')
    ).toContainText('Exact human alternative text');
    await expect(
      page.locator('[data-og7="media-batch-execute"]')
    ).toBeDisabled();
    expect(calls.executes).toHaveLength(0);
    await page.locator('[data-og7="media-manifest-confirmation"]').check();
    await page.locator('[data-og7="media-batch-execute"]').click();
    await expect(
      area(page).locator('[data-og7="media-batch-receipt"]')
    ).toBeVisible();
    expect(calls.plans).toHaveLength(1);
    expect(calls.executes).toHaveLength(1);
    expect(calls.plans[0].assets).toHaveLength(2);
    expect(calls.plans[0].assets[0].altText).toBe(
      'Exact human alternative text'
    );
    expect(calls.executes[0]).toMatchObject({
      planId: 'synthetic-plan',
      confirmation: 'synthetic-plan',
      humanReviewed: true
    });
  });

  test('media workspace rights evidence explicitly covers the selected files once at dossier scope', async ({
    page
  }, info) => {
    const { calls } = await fixture(page);
    await page.goto(context.path('media'));
    const tiles = area(page).locator('[data-og7="media-tile"]');
    await tiles.nth(0).getByRole('checkbox').check();
    await tiles.nth(1).getByRole('checkbox').check();
    await area(page).locator('[data-og7="media-dossier-rules"]').click();
    const editor = page.locator('dialog[open] [data-og7="media-usage-editor"]');
    await expect(
      page.locator('[data-og7="media-rules-future"]')
    ).not.toBeChecked();
    await editor
      .locator('[data-og7="media-usage-evidence"]')
      .fill('Synthetic permission reference for these two files');
    await editor.locator('[data-og7="media-usage-confirmation"]').check();
    await page
      .locator('dialog[open]')
      .screenshot({ path: info.outputPath('media-shared-rules.png') });
    await editor.locator('[data-og7="media-usage-save"]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(calls.rules).toHaveLength(1);
    expect(calls.rules[0]).toMatchObject({
      scope: 'dossier',
      expectedRevision: 'workspace-v1',
      coveredAssetIds: ['synthetic-media-0', 'synthetic-media-1']
    });
  });

  test('media workspace lost receipt suspends writes and verifies read-only without replay', async ({
    page
  }) => {
    const { calls } = await fixture(page);
    await page.route(
      '**/api/admin/sponsorships/media/batch/execute',
      async (route) => {
        calls.executes.push(route.request().postDataJSON());
        await route.abort('failed');
      }
    );
    await page.route('**/api/admin/sponsorships/media/receipt?**', (route) =>
      route.fulfill({
        json: {
          found: true,
          result: {
            requestId: calls.executes[0]?.requestId,
            planId: 'synthetic-plan',
            status: 'completed',
            action: 'approve',
            items: []
          }
        }
      })
    );
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('checkbox')
      .check();
    await area(page).locator('[data-og7="media-batch-approve"]').click();
    await page.locator('[data-og7="media-manifest-confirmation"]').check();
    await page.locator('[data-og7="media-batch-execute"]').click();
    await expect(page.locator('dialog[open] [role="alert"]')).toBeVisible();
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: 'Fermer', exact: true })
      .click();
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeDisabled();
    await area(page).locator('[data-og7="media-reconcile"]').click();
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeEnabled();
    expect(calls.executes).toHaveLength(1);
  });

  test('media workspace reader can inspect with the keyboard while all writes and private history stay unavailable', async ({
    page
  }) => {
    const { calls } = await fixture(page, 'reader');
    await page.goto(context.path('media'));
    const tile = area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button');
    await tile.focus();
    await tile.press('Enter');
    await expect(
      area(page).locator('[data-og7="media-full-preview"] img')
    ).toBeVisible();
    await expect(
      area(page).locator('[data-og7="media-inspector-alt"]')
    ).toBeDisabled();
    await expect(
      area(page).locator('[data-og7="media-inspector-approve"]')
    ).toBeDisabled();
    await expect(area(page).locator('[data-og7="media-history"]')).toHaveCount(
      0
    );
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeDisabled();
    expect(calls.plans).toHaveLength(0);
    expect(calls.executes).toHaveLength(0);
  });

  test('media workspace future inheritance requires an explicit unchecked scope and private evidence', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    Object.assign(state, { assets: [] });
    await page.goto(context.path('media'));
    await area(page).locator('[data-og7="media-dossier-rules"]').click();
    const future = page.locator('[data-og7="media-rules-future"]');
    const editor = page.locator('dialog[open] [data-og7="media-usage-editor"]');
    await expect(future).not.toBeChecked();
    await expect(
      editor.locator('[data-og7="media-usage-save"]')
    ).toBeDisabled();
    await future.check();
    await editor
      .locator('[data-og7="media-usage-evidence"]')
      .fill('Synthetic agreement explicitly covering future photographs');
    await editor.locator('[data-og7="media-usage-confirmation"]').check();
    await editor.locator('[data-og7="media-usage-save"]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(calls.rules[0]).toMatchObject({
      includesFutureUploads: true,
      coveredAssetIds: [],
      scope: 'dossier'
    });
  });

  test('media workspace site selection manifest warns about immediate website visibility and keeps social authorization separate', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    Object.assign(state.assets[0], { reviewStatus: 'approved' });
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    const inspector = area(page).locator('[data-og7="media-inspector"]');
    await inspector.getByText('Plus d’options', { exact: true }).click();
    await inspector
      .getByRole('button', { name: 'Choisir pour le site', exact: true })
      .click();
    await expect(page.locator('dialog[open]')).toContainText(
      'Il peut devenir visible immédiatement'
    );
    await expect(page.locator('dialog[open]')).toContainText(
      'aucune publication sur les réseaux sociaux'
    );
    expect(calls.plans[0].action).toBe('website_select');
    expect(calls.executes).toHaveLength(0);
    await expect(
      page.locator('[data-og7="media-batch-execute"]')
    ).toBeDisabled();
  });
}
