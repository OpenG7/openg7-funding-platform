import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';
import { controllerPath } from './support/controller-journeys.fixtures.js';
import {
  openMediaLibraryTools,
  openPublicationSection
} from './support/sponsorship-dossier.js';
import {
  galleryObligationIds,
  intelligentGalleryFixture
} from './support/intelligent-media-gallery.fixtures.js';

const hook = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`[data-og7="${name}"]`);

for (const [language, width] of [
  ['fr-CA', 1920],
  ['en', 390]
] as const) {
  test(`an empty known library offers photos and logo imports without granting rights ${language}`, async ({
    page
  }, info) => {
    const { state, calls, commands, base } = await intelligentGalleryFixture(
      page,
      {
        language,
        count: 0,
        missingIdentity: true,
        role: language === 'fr-CA' ? 'owner' : 'operator'
      }
    );
    await page.addInitScript(
      (theme) =>
        localStorage.setItem(
          'openg7.pilotage.appearance.v1',
          JSON.stringify({ theme, system: false })
        ),
      language === 'fr-CA' ? 'night' : 'mineral'
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(controllerPath('media'));
    await expect(hook(page, 'media-empty-state')).toBeVisible();
    await expect(hook(page, 'media-empty-steps')).toBeVisible();
    await expect(hook(page, 'media-gallery-empty')).toBeVisible();
    await expect(hook(page, 'media-identity-alert')).toBeVisible();
    await expect(hook(page, 'media-assistant')).toBeVisible();
    await expect(hook(page, 'media-inspector')).toBeHidden();
    await expect(hook(page, 'publication-advanced')).not.toHaveAttribute(
      'open'
    );
    await expect(hook(page, 'media-public-profile-summary')).toBeVisible();
    for (const control of [
      'media-count-total',
      'media-count-review',
      'media-count-approved',
      'media-count-consent',
      'media-library-tools',
      'media-page-size',
      'media-next-page',
      'media-select-page',
      'media-selection-actions',
      'media-batch-analyze',
      'media-analysis-count'
    ])
      await expect(hook(page, control)).toBeHidden();
    for (const action of ['media-add-photos', 'media-add-logo'])
      await expect(hook(page, action)).toHaveCount(1);
    await expect(hook(page, 'media-upload-files')).toBeEnabled();
    await expect(hook(page, 'media-upload-logo')).toBeEnabled();
    const primaryColor = await hook(page, 'media-add-photos').evaluate(
      (button) => {
        const style = getComputedStyle(button);
        const token = style.getPropertyValue('--og7-admin-primary').trim();
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext('2d')!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        return {
          token,
          actual: rgba(style.backgroundColor),
          expected: rgba(token)
        };
      }
    );
    expect(primaryColor.token).not.toBe('');
    expect(primaryColor.actual).toEqual(primaryColor.expected);
    expect(commands.uploads).toEqual([]);
    expect(calls.executes).toEqual([]);
    expect(base.commands).toEqual([]);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="dossier-media"]')
          .analyze()
      ).violations
    ).toEqual([]);
    await hook(page, 'dossier-media').screenshot({
      path: info.outputPath(`media-empty-${language}-${width}.png`)
    });
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV0cAAAAASUVORK5CYII=',
      'base64'
    );
    await hook(page, 'media-upload-files').setInputFiles({
      name: 'synthetic-first-photo.png',
      mimeType: 'image/png',
      buffer: image
    });
    await expect(hook(page, 'media-tile')).toHaveCount(1);
    await expect(hook(page, 'media-empty-state')).toHaveCount(0);
    expect(state.assets[0]).toMatchObject({
      kind: 'supporting_image',
      reviewStatus: 'pending_review',
      websiteSelected: false,
      usage: { state: 'needs_confirmation', channels: [], targets: [] }
    });
    await hook(page, 'media-upload-logo').setInputFiles({
      name: 'synthetic-first-logo.png',
      mimeType: 'image/png',
      buffer: image
    });
    await expect(hook(page, 'media-tile')).toHaveCount(2);
    expect(state.assets[1]).toMatchObject({
      kind: 'logo',
      reviewStatus: 'pending_review',
      websiteSelected: false,
      usage: { state: 'needs_confirmation' }
    });
    await expect(hook(page, 'media-assistant')).toBeVisible();
    await expect(hook(page, 'media-page-size')).toBeHidden();
    expect(commands.uploads).toHaveLength(2);
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
    expect(calls.rules).toEqual([]);
    expect(base.commands).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    await hook(page, 'dossier-media').screenshot({
      path: info.outputPath(`media-imported-${language}-${width}.png`)
    });
  });
}

test('an unavailable media inventory never becomes a known empty library before a confirmed reread', async ({
  page
}) => {
  const { commands } = await intelligentGalleryFixture(page, { count: 0 });
  commands.workspaceStatus = 503;
  await page.goto(controllerPath('media'));
  await expect(hook(page, 'media-workspace-error')).toBeVisible();
  await expect(hook(page, 'media-empty-state')).toBeHidden();
  await expect(hook(page, 'media-gallery-empty')).toBeHidden();
  commands.workspaceStatus = 200;
  await hook(page, 'media-refresh').click();
  await expect(hook(page, 'media-empty-state')).toBeVisible();
  await expect(hook(page, 'media-workspace-error')).toHaveCount(0);
  expect(commands.uploads).toEqual([]);
  expect(commands.writes).toEqual([]);
  commands.workspaceStatus = 503;
  await hook(page, 'media-upload-files').setInputFiles({
    name: 'synthetic-upload-before-unavailable-read.png',
    mimeType: 'image/png',
    buffer: Buffer.from('Synthetic intercepted image bytes')
  });
  await expect(hook(page, 'media-upload-result')).toHaveAttribute(
    'data-state',
    'received'
  );
  await expect(hook(page, 'media-workspace-error')).toBeVisible();
  await expect(hook(page, 'media-empty-state')).toBeHidden();
  await expect(hook(page, 'media-gallery-empty')).toBeHidden();
  await expect(hook(page, 'media-assistant')).toBeHidden();
  commands.workspaceStatus = 200;
  await hook(page, 'media-refresh').click();
  await expect(hook(page, 'media-tile')).toHaveCount(1);
  await expect(hook(page, 'media-empty-state')).toBeHidden();
  expect(commands.uploads).toHaveLength(1);
  expect(commands.writes).toEqual([]);
});

test('one library keeps recorded document images and correction requests accessible through contextual controls', async ({
  page
}, info) => {
  const { state, calls, base, commands } = await intelligentGalleryFixture(
    page,
    {
      count: 5,
      documentIndexes: [2]
    }
  );
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.addInitScript(() =>
    localStorage.setItem(
      'openg7.pilotage.appearance.v1',
      JSON.stringify({ theme: 'night', system: false })
    )
  );
  Object.assign(base.sponsor, {
    sponsor_review_status: 'approved',
    public_display_consent: true,
    sponsor_public_slug: 'synthetic-gallery-demo',
    sponsor_public_summary:
      'Une organisation synthétique prépare des ressources ouvertes pour sa communauté.'
  });
  Object.assign(base.progress, {
    reviewStatus: 'approved',
    publicConsent: true,
    publicEligible: true,
    website: {
      visible: true,
      held: false,
      canPublish: true,
      version: 'synthetic-visible-site-v1',
      blockers: []
    }
  });
  Object.assign(state.assets[1]!.moderation, { state: 'correction_requested' });
  Object.assign(state.assets[3]!, {
    reviewStatus: 'approved',
    websiteSelected: true
  });
  await page.goto(controllerPath('media'));
  await expect(hook(page, 'media-tile')).toHaveCount(5);
  await openMediaLibraryTools(page);
  const category = hook(page, 'media-library-category');
  await category.selectOption('documents');
  const tiles = hook(page, 'media-tile');
  await expect(tiles).toHaveCount(1);
  await expect(tiles).toHaveAttribute('data-og7-id', state.assets[2]!.id);
  await expect(tiles.locator('img')).toBeVisible();
  await expect(hook(page, 'media-empty-state')).toHaveCount(0);
  await category.selectOption('media');
  await expect(tiles).toHaveCount(5);
  const corrections = hook(page, 'media-corrections-view');
  await expect(corrections).not.toHaveAttribute('open');
  await corrections.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(corrections).toHaveAttribute('open', '');
  await category.selectOption('corrections');
  await expect(tiles).toHaveCount(1);
  await expect(tiles).toHaveAttribute('data-og7-id', state.assets[1]!.id);
  await expect(corrections).toHaveAttribute('open', '');
  await category.selectOption('media');
  await expect(tiles).toHaveCount(5);
  const beforeProfileReads = commands.workspaceReads;
  const profile = hook(page, 'publication-advanced');
  await expect(profile).not.toHaveAttribute('open');
  await profile.screenshot({
    path: info.outputPath('public-profile-collapsed-fr-CA-1920.png')
  });
  await openPublicationSection(page, 'profile');
  const websiteMedia = hook(page, 'publication-website-media');
  await expect(websiteMedia).toContainText(state.assets[3]!.originalFilename);
  await expect(
    profile.locator('[data-og7="publication-public-preview"]')
  ).toBeVisible();
  await profile.screenshot({
    path: info.outputPath('public-profile-open-fr-CA-1920.png')
  });
  const selectedMedia = websiteMedia.locator(
    `[data-og7-id="${state.assets[3]!.id}"]`
  );
  await selectedMedia.focus();
  await page.keyboard.press('Enter');
  const inspector = hook(page, 'media-inspector');
  await expect(
    inspector.getByRole('heading', {
      name: state.assets[3]!.originalFilename,
      exact: true
    })
  ).toBeVisible();
  await expect(inspector).toBeFocused();
  await expect(hook(page, 'media-gallery')).toHaveCount(1);
  expect(commands.workspaceReads).toBe(beforeProfileReads);
  expect(calls.plans).toEqual([]);
  expect(calls.executes).toEqual([]);
  expect(calls.rules).toEqual([]);
  expect(base.commands).toEqual([]);
});

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [1536, 768, 390]) {
    test(`one dossier gallery shows actual media and separate identity in ${language} at ${width}px`, async ({
      page
    }, info) => {
      const { state, calls, base } = await intelligentGalleryFixture(page, {
        language
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(controllerPath('media'));
      await expect(hook(page, 'media-tile')).toHaveCount(8);
      if (width === 1536) {
        const firstMediaTop = await hook(page, 'media-tile')
          .first()
          .evaluate(
            (element) => element.getBoundingClientRect().top + window.scrollY
          );
        expect(firstMediaTop).toBeLessThan(800);
      }
      await expect(hook(page, 'dossier-identity')).toHaveCount(0);
      await expect(hook(page, 'sponsors-list')).toBeHidden();
      await expect(hook(page, 'dossier-tabs').getByRole('button')).toHaveCount(
        6
      );
      await expect(hook(page, 'media-library-views')).toHaveCount(0);
      await expect(hook(page, 'media-assistant')).toBeVisible();
      await expect(hook(page, 'media-inspector')).toBeHidden();
      await expect(hook(page, 'media-review-workspace')).not.toContainText(
        'admin.mediaReview.'
      );
      await openMediaLibraryTools(page);
      await hook(page, 'media-search').fill('photo-020');
      await expect(hook(page, 'media-tile')).toHaveCount(1);
      await expect(hook(page, 'media-tile')).toContainText('photo-020.webp');
      await hook(page, 'media-search').fill('');
      await hook(page, 'media-kind-filter').selectOption('logo');
      await expect(hook(page, 'media-tile')).toHaveCount(1);
      await hook(page, 'media-kind-filter').selectOption('all');
      await hook(page, 'media-select-page').click();
      await expect(
        hook(page, 'media-tile').getByRole('checkbox', { checked: true })
      ).toHaveCount(8);
      await hook(page, 'media-search').fill('photo-020');
      await expect(
        hook(page, 'media-tile').getByRole('checkbox', { checked: true })
      ).toHaveCount(0);
      await expect(hook(page, 'media-selection-actions')).toContainText('8');
      await hook(page, 'media-clear-selection').click();
      await hook(page, 'media-search').fill('');
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        )
        .toBe(true);
      await expect(hook(page, 'media-preparation-summary')).not.toContainText(
        /18|simulat/i
      );
      expect(state.assets).toHaveLength(20);
      expect(state.preparationObligations).toHaveLength(2);
      expect(calls.executes).toHaveLength(0);
      expect(base.commands).toEqual([]);
      await hook(page, 'dossier-media-summary').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`gallery-${language}-${width}.png`),
        fullPage: true,
        animations: 'disabled'
      });
      if (width === 1536 || width === 390) {
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="dossier-media"]')
              .analyze()
          ).violations
        ).toEqual([]);
      }
    });
  }
}

test('a confirmed multi-file assignment stays private and removing it preserves the files', async ({
  page
}) => {
  const { state, calls, base } = await intelligentGalleryFixture(page);
  await page.goto(controllerPath('media'));
  await expect(hook(page, 'media-tile')).toHaveCount(8);
  await hook(page, 'media-tile').nth(1).getByRole('checkbox').check();
  await hook(page, 'media-tile').nth(2).getByRole('checkbox').check();
  await hook(page, 'media-preparation-target').selectOption(
    galleryObligationIds[1]
  );
  await hook(page, 'media-preparation-assign').click();
  await expect(hook(page, 'media-batch-manifest')).toBeVisible();
  await expect(page.locator('dialog[open]')).toContainText('Facebook');
  await expect(hook(page, 'media-batch-execute')).toBeDisabled();
  expect(calls.executes).toHaveLength(0);
  await hook(page, 'media-manifest-confirmation').check();
  await hook(page, 'media-batch-execute').click();
  await expect(hook(page, 'media-batch-receipt')).toBeVisible();
  expect(calls.plans[0]).toMatchObject({
    action: 'preparation_assign',
    targetObligationId: galleryObligationIds[1],
    targetObligationVersion: 1
  });
  expect(state.preparationAssignments).toHaveLength(2);
  expect(
    state.assets.every(
      (asset) =>
        !asset.websiteSelected && asset.reviewStatus === 'pending_review'
    )
  ).toBe(true);
  expect(base.commands).toEqual([]);
  await hook(page, 'media-tile').nth(1).getByRole('checkbox').check();
  await hook(page, 'media-tile').nth(2).getByRole('checkbox').check();
  await hook(page, 'media-preparation-target').selectOption(
    galleryObligationIds[1]
  );
  await hook(page, 'media-preparation-unassign').click();
  await hook(page, 'media-manifest-confirmation').check();
  await hook(page, 'media-batch-execute').click();
  await expect.poll(() => state.preparationAssignments?.length).toBe(0);
  expect(state.assets).toHaveLength(20);
  expect(calls.plans.map((plan) => plan.action)).toEqual([
    'preparation_assign',
    'preparation_unassign'
  ]);
  expect(base.commands).toEqual([]);
});

test('a stale workspace plan cannot execute or publish a selection', async ({
  page
}) => {
  const { commands, calls, state } = await intelligentGalleryFixture(page);
  commands.conflictNextPlan = true;
  await page.goto(controllerPath('media'));
  await hook(page, 'media-tile').nth(1).getByRole('checkbox').check();
  await hook(page, 'media-preparation-target').selectOption(
    galleryObligationIds[0]
  );
  await hook(page, 'media-preparation-assign').click();
  await expect(hook(page, 'media-workspace-error')).toBeVisible();
  expect(calls.executes).toHaveLength(0);
  expect(state.preparationAssignments).toEqual([]);
  expect(state.assets.every((asset) => !asset.websiteSelected)).toBe(true);
});

test('readers inspect the library without mutation controls becoming available', async ({
  page
}) => {
  const { calls } = await intelligentGalleryFixture(page, { role: 'reader' });
  await page.goto(controllerPath('media'));
  await expect(hook(page, 'media-tile')).toHaveCount(8);
  await expect(hook(page, 'media-upload-files')).toBeDisabled();
  await expect(hook(page, 'media-select-page')).toBeDisabled();
  await expect(hook(page, 'media-preparation-assign')).toHaveCount(0);
  expect(calls.executes).toHaveLength(0);
});

test('an empty library and missing profile open the identity owner without inventing analysis', async ({
  page
}) => {
  await intelligentGalleryFixture(page, { count: 0, missingIdentity: true });
  await page.goto(controllerPath('media'));
  await expect(hook(page, 'media-gallery-empty')).toBeVisible();
  await expect(hook(page, 'media-identity-alert')).toBeVisible();
  await hook(page, 'media-open-identity').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/tab=identity#dossier-identity$/);
  await expect(hook(page, 'dossier-identity')).toBeFocused();
  await expect(hook(page, 'media-review-workspace')).toHaveCount(0);
});

test('a multiple import reports a rejected file while retaining a successful upload', async ({
  page
}) => {
  const { commands } = await intelligentGalleryFixture(page);
  await page.goto(controllerPath('media'));
  await expect(hook(page, 'media-upload-files')).toBeEnabled();
  await hook(page, 'media-upload-files').setInputFiles([
    {
      name: 'good-file.png',
      mimeType: 'image/png',
      buffer: Buffer.from('synthetic bytes for intercepted UI transport')
    },
    {
      name: 'bad-file.png',
      mimeType: 'image/png',
      buffer: Buffer.from('invalid synthetic image')
    }
  ]);
  await expect.poll(() => commands.uploads.length).toBe(2);
  await expect(
    hook(page, 'media-upload-result').filter({ hasText: 'good-file.png' })
  ).toHaveAttribute('data-state', 'received');
  await expect(
    hook(page, 'media-upload-result').filter({ hasText: 'bad-file.png' })
  ).toHaveAttribute('data-state', 'rejected');
});

test('a group correction requires a reason and exact human confirmation without sending a message', async ({
  page
}) => {
  const { calls, base } = await intelligentGalleryFixture(page);
  await page.goto(controllerPath('media'));
  await hook(page, 'media-tile').nth(1).getByRole('checkbox').check();
  await hook(page, 'media-tile').nth(2).getByRole('checkbox').check();
  await hook(page, 'media-batch-correction').click();
  const form = page.locator('dialog[open]');
  await form.getByRole('combobox').first().selectOption('IP_RIGHTS');
  await form
    .getByRole('textbox')
    .nth(0)
    .fill('Vérification des permissions nécessaire pour cette sélection.');
  await form
    .getByRole('textbox')
    .nth(1)
    .fill('Clarifier la permission de diffusion de ces deux images.');
  await form
    .getByRole('button', {
      name: 'Examiner la demande de correction',
      exact: true
    })
    .click();
  await expect(hook(page, 'media-correction-notification-scope')).toContainText(
    'Aucun courriel'
  );
  await expect(hook(page, 'media-batch-execute')).toBeDisabled();
  expect(calls.executes).toHaveLength(0);
  await hook(page, 'media-manifest-confirmation').check();
  await hook(page, 'media-batch-execute').click();
  await expect(hook(page, 'media-batch-receipt')).toBeVisible();
  expect(calls.plans[0]).toMatchObject({
    action: 'request_correction',
    reason: 'IP_RIGHTS'
  });
  expect(calls.plans[0]!.assets).toHaveLength(2);
  expect(base.commands).toEqual([]);
});

test('private multi-download confirms exact versions before requesting each processed file', async ({
  page
}) => {
  const { commands, calls, state } = await intelligentGalleryFixture(page);
  await page.goto(controllerPath('media'));
  await hook(page, 'media-tile').nth(1).getByRole('checkbox').check();
  await hook(page, 'media-tile').nth(2).getByRole('checkbox').check();
  await hook(page, 'media-batch-export').click();
  await expect(hook(page, 'media-export-manifest')).toContainText(
    'photo-002.webp'
  );
  await expect(hook(page, 'media-export-manifest')).toContainText(
    'photo-003.webp'
  );
  await expect(hook(page, 'media-export-execute')).toBeDisabled();
  expect(commands.exports).toEqual([]);
  await hook(page, 'media-export-confirmation').check();
  await hook(page, 'media-export-execute').click();
  await expect(
    hook(page, 'media-export-results').locator('[data-state="received"]')
  ).toHaveCount(2);
  expect(commands.exports).toHaveLength(2);
  for (const request of commands.exports) {
    expect(request).toMatchObject({
      contributionId: state.contributionId,
      confirmation: request.assetId
    });
    expect(
      state.assets.find((asset) => asset.id === request.assetId)?.version
    ).toBe(request.expectedVersion);
  }
  expect(calls.executes).toHaveLength(0);
});
