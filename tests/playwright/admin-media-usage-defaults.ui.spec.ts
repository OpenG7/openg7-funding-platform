import type { Page } from '@playwright/test';
import type { SponsorMediaUsageRights } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { controllerPath } from './support/controller-journeys.fixtures.js';
import { intelligentGalleryFixture } from './support/intelligent-media-gallery.fixtures.js';

const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);
const unknownUsage: SponsorMediaUsageRights = {
  state: 'needs_confirmation',
  channels: [],
  targets: [],
  transformations: [],
  credit: null,
  restrictions: null
};

async function openMediaSummary(
  page: Page,
  language: 'fr-CA' | 'en'
): Promise<void> {
  await hook(page, 'media-tile').nth(1).getByRole('button').click();
  await hook(page, 'media-inspector')
    .locator('[data-og7="context-controller"]')
    .getByRole('button', {
      name: language === 'en' ? 'Permissions' : 'Autorisations',
      exact: true
    })
    .click();
  await expect(hook(page, 'media-acceptance-review')).toBeVisible();
}

for (const [language, width] of [
  ['fr-CA', 1440],
  ['en', 390]
] as const) {
  test(`promised services never grant media rights and the summary offers three clear choices in ${language}`, async ({
    page
  }, info) => {
    const { state, calls } = await intelligentGalleryFixture(page, {
      language
    });
    const obligations = state.preparationObligations!;
    Object.assign(state, {
      rules: [],
      preparationObligations: [
        ...obligations,
        {
          ...obligations[1],
          id: '20000000-0000-4000-8000-000000000803',
          target: 'openg20',
          state: 'blocked',
          acceptsMedia: true
        },
        {
          ...obligations[1],
          id: '20000000-0000-4000-8000-000000000804',
          channel: 'linkedin',
          acceptsMedia: false
        }
      ]
    });
    Object.assign(state.assets[1]!, {
      usage: unknownUsage,
      readiness: {
        state: 'blocked',
        reasons: ['MEDIA_USAGE_CONFIRMATION_REQUIRED']
      }
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(controllerPath('media'));
    await openMediaSummary(page, language);
    const review = hook(page, 'media-acceptance-review');
    await expect(hook(page, 'media-acceptance-pending')).toBeVisible();
    await expect(hook(page, 'media-acceptance-approve')).toHaveText(
      language === 'en' ? 'Approve and continue' : 'Approuver et continuer'
    );
    await expect(hook(page, 'media-acceptance-approve')).toBeDisabled();
    await expect(hook(page, 'media-acceptance-reject')).toHaveText(
      language === 'en' ? 'Reject' : 'Refuser'
    );
    await expect(hook(page, 'media-acceptance-cancel')).toHaveText(
      language === 'en' ? 'Cancel' : 'Annuler'
    );
    await expect(hook(page, 'media-acceptance-proof')).toHaveCount(0);
    await expect(hook(page, 'media-acceptance-unavailable')).toHaveCount(0);
    await expect(review.getByRole('combobox')).toHaveCount(0);
    for (const name of [
      'media-usage-editor',
      'media-usage-evidence',
      'media-usage-confirmation',
      'media-rules-future'
    ])
      await expect(hook(page, name)).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    await page.locator('dialog[open]').screenshot({
      path: info.outputPath(
        `media-permissions-summary-${language}-${width}.png`
      )
    });
    await hook(page, 'media-acceptance-cancel').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(state.assets[1]!.usage).toEqual(unknownUsage);
    expect(calls.rules).toEqual([]);
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
  });
}

for (const usageState of [
  'confirmed',
  'withdrawn',
  'needs_confirmation'
] as const) {
  test(`media summary preserves existing ${usageState} rights and metadata without manual editing`, async ({
    page
  }) => {
    const { state, calls } = await intelligentGalleryFixture(page);
    const usage: SponsorMediaUsageRights = {
      state: usageState,
      channels: ['linkedin'],
      targets: ['openg20'],
      transformations: ['technical', 'crop'],
      credit: 'Synthetic photographer',
      restrictions: 'Synthetic restriction requiring human review.'
    };
    Object.assign(state, { rules: [] });
    Object.assign(state.assets[1]!, { usage });
    await page.goto(controllerPath('media'));
    await openMediaSummary(page, 'fr-CA');
    const review = hook(page, 'media-acceptance-review');
    await expect(review).toContainText(usage.credit!);
    await expect(review).toContainText(usage.restrictions!);
    await expect(hook(page, 'media-acceptance-unavailable')).toHaveCount(
      usageState === 'confirmed' ? 1 : 0
    );
    await expect(hook(page, 'media-acceptance-proof')).toHaveCount(0);
    await expect(hook(page, 'media-acceptance-approve')).toBeDisabled();
    if (usageState === 'confirmed') {
      await expect(review).toContainText('LinkedIn');
      await expect(hook(page, 'media-acceptance-pending')).toHaveCount(0);
      await hook(page, 'media-acceptance-restrictions').check();
      await expect(hook(page, 'media-acceptance-approve')).toBeEnabled();
    } else await expect(hook(page, 'media-acceptance-pending')).toBeVisible();
    await expect(hook(page, 'media-usage-editor')).toHaveCount(0);
    await hook(page, 'media-acceptance-cancel').click();
    expect(state.assets[1]!.usage).toEqual(usage);
    expect(calls.rules).toEqual([]);
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
  });
}

test('media consent stays pending when no promised image service is available', async ({
  page
}) => {
  const { state, calls } = await intelligentGalleryFixture(page);
  Object.assign(state, { rules: [], preparationObligations: [] });
  Object.assign(state.assets[1]!, { usage: unknownUsage });
  await page.goto(controllerPath('media'));
  await openMediaSummary(page, 'fr-CA');
  await expect(hook(page, 'media-acceptance-pending')).toBeVisible();
  await expect(hook(page, 'media-acceptance-approve')).toBeDisabled();
  await expect(hook(page, 'media-usage-editor')).toHaveCount(0);
  expect(calls.rules).toEqual([]);
  expect(calls.plans).toEqual([]);
  expect(calls.executes).toEqual([]);
});

test('dossier and batch controls cannot grant permission to current or future files', async ({
  page
}) => {
  const { state, calls } = await intelligentGalleryFixture(page);
  Object.assign(state, { rules: [] });
  Object.assign(state.assets[1]!, {
    usage: null,
    batchId: state.batches[0]!.id
  });
  await page.goto(controllerPath('media'));
  for (const name of [
    'media-dossier-rules',
    'media-batch-rules',
    'media-rules-future'
  ])
    await expect(hook(page, name)).toHaveCount(0);
  await openMediaSummary(page, 'fr-CA');
  await expect(hook(page, 'media-acceptance-pending')).toBeVisible();
  await expect(hook(page, 'media-acceptance-approve')).toBeDisabled();
  await expect(page.locator('dialog[open]').getByRole('combobox')).toHaveCount(
    0
  );
  expect(state.assets[1]!.usage).toBeNull();
  expect(calls.rules).toEqual([]);
  expect(calls.plans).toEqual([]);
  expect(calls.executes).toEqual([]);
});

for (const scenario of [
  { state: 'withdrawn', channels: [] },
  { state: 'needs_confirmation', channels: ['linkedin'] }
] as const) {
  test(`media summary preserves an incomplete destination list for ${scenario.state} permissions`, async ({
    page
  }) => {
    const { state, calls } = await intelligentGalleryFixture(page);
    const usage = { ...unknownUsage, ...scenario };
    Object.assign(state, { rules: [] });
    Object.assign(state.assets[1]!, { usage });
    await page.goto(controllerPath('media'));
    await openMediaSummary(page, 'fr-CA');
    await expect(hook(page, 'media-acceptance-pending')).toBeVisible();
    await expect(hook(page, 'media-acceptance-approve')).toBeDisabled();
    await expect(hook(page, 'media-usage-editor')).toHaveCount(0);
    await hook(page, 'media-acceptance-cancel').click();
    expect(state.assets[1]!.usage).toEqual(usage);
    expect(calls.rules).toEqual([]);
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
  });
}
