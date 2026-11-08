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

async function openMediaRules(
  page: Page,
  language: 'fr-CA' | 'en'
): Promise<void> {
  await hook(page, 'media-tile').nth(1).getByRole('button').click();
  const inspector = hook(page, 'media-inspector');
  await inspector
    .getByText(language === 'en' ? 'More options' : 'Plus d’options', {
      exact: true
    })
    .click();
  await inspector
    .getByRole('button', {
      name:
        language === 'en'
          ? 'Customize permissions'
          : 'Personnaliser les autorisations',
      exact: true
    })
    .click();
  await expect(hook(page, 'media-usage-editor')).toBeVisible();
}

for (const [language, width] of [
  ['fr-CA', 1440],
  ['en', 390]
] as const) {
  test(`media permissions suggest the promised scope and still require evidence and confirmation in ${language}`, async ({
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
    Object.assign(state.assets[1]!, { usage: unknownUsage });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(controllerPath('media'));
    await openMediaRules(page, language);
    const editor = hook(page, 'media-usage-editor');
    await expect(hook(page, 'media-usage-suggestion')).toBeVisible();
    for (const channel of ['website', 'facebook'])
      await expect(
        editor.locator(`[data-og7-id="channel:${channel}"]`)
      ).toBeChecked();
    await expect(
      editor.locator('[data-og7-id="channel:linkedin"]')
    ).not.toBeChecked();
    for (const target of ['openg7', 'openg20'])
      await expect(
        editor.locator(`[data-og7-id="target:${target}"]`)
      ).toBeChecked();
    await expect(
      editor.locator('[data-og7-id^="transform:"]:checked')
    ).toHaveCount(0);
    await expect(hook(page, 'media-usage-evidence')).toHaveValue('');
    await expect(hook(page, 'media-usage-confirmation')).not.toBeChecked();
    await expect(hook(page, 'media-usage-save')).toBeDisabled();
    expect(calls.rules).toEqual([]);

    await editor.locator('[data-og7-id="channel:facebook"]').uncheck();
    await hook(page, 'media-usage-evidence').fill(
      'Synthetic authorization covering the selected media and destinations'
    );
    await hook(page, 'media-usage-confirmation').check();
    await expect(hook(page, 'media-usage-save')).toBeDisabled();
    await editor.locator('[data-og7-id="transform:technical"]').check();
    await expect(hook(page, 'media-usage-confirmation')).not.toBeChecked();
    await expect(hook(page, 'media-usage-save')).toBeDisabled();
    await hook(page, 'media-usage-confirmation').check();
    await expect(hook(page, 'media-usage-save')).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    await page.locator('dialog[open]').screenshot({
      path: info.outputPath(
        `media-permissions-defaults-${language}-${width}.png`
      )
    });
    await hook(page, 'media-usage-save').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(calls.rules).toHaveLength(1);
    expect(calls.rules[0]).toMatchObject({
      scope: 'media',
      scopeId: state.assets[1]!.id,
      coveredAssetIds: [state.assets[1]!.id],
      usage: {
        state: 'confirmed',
        channels: ['website'],
        targets: ['openg7', 'openg20'],
        transformations: ['technical']
      }
    });
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
  });
}

for (const state of ['confirmed', 'withdrawn', 'needs_confirmation'] as const) {
  test(`media permission suggestions preserve an existing ${state} scope and its metadata`, async ({
    page
  }) => {
    const fixture = await intelligentGalleryFixture(page);
    const usage: SponsorMediaUsageRights = {
      state,
      channels: ['linkedin'],
      targets: ['openg20'],
      transformations: ['technical', 'crop'],
      credit: 'Synthetic photographer',
      restrictions: 'Synthetic restriction requiring human review.'
    };
    Object.assign(fixture.state, { rules: [] });
    Object.assign(fixture.state.assets[1]!, { usage });
    await page.goto(controllerPath('media'));
    await openMediaRules(page, 'fr-CA');
    const editor = hook(page, 'media-usage-editor');
    await expect(hook(page, 'media-usage-suggestion')).toHaveCount(0);
    await expect(
      editor.locator('[data-og7-id="channel:linkedin"]')
    ).toBeChecked();
    await expect(
      editor.locator('[data-og7-id="channel:website"]')
    ).not.toBeChecked();
    await expect(
      editor.locator('[data-og7-id="channel:facebook"]')
    ).not.toBeChecked();
    await expect(
      editor.locator('[data-og7-id="target:openg20"]')
    ).toBeChecked();
    await expect(
      editor.locator('[data-og7-id="target:openg7"]')
    ).not.toBeChecked();
    await expect(
      editor.locator('[data-og7-id="transform:crop"]')
    ).toBeChecked();
    await expect(hook(page, 'media-usage-credit')).toHaveValue(usage.credit!);
    await expect(hook(page, 'media-usage-restrictions')).toHaveValue(
      usage.restrictions!
    );
    await expect(hook(page, 'media-usage-evidence')).toHaveValue('');
    await expect(hook(page, 'media-usage-confirmation')).not.toBeChecked();
    await expect(hook(page, 'media-usage-save')).toBeDisabled();
    expect(fixture.calls.rules).toEqual([]);
  });
}

test('media permissions remain empty when no promised image service is available', async ({
  page
}) => {
  const { state, calls } = await intelligentGalleryFixture(page);
  Object.assign(state, { rules: [], preparationObligations: [] });
  Object.assign(state.assets[1]!, { usage: unknownUsage });
  await page.goto(controllerPath('media'));
  await openMediaRules(page, 'fr-CA');
  const editor = hook(page, 'media-usage-editor');
  await expect(editor.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(hook(page, 'media-usage-suggestion')).toHaveCount(0);
  await expect(hook(page, 'media-usage-save')).toBeDisabled();
  expect(calls.rules).toEqual([]);
});

test('new dossier and batch permissions suggest the promised scope without granting rights', async ({
  page
}) => {
  const { state, calls } = await intelligentGalleryFixture(page);
  Object.assign(state, { rules: [] });
  Object.assign(state.assets[1]!, {
    usage: null,
    batchId: state.batches[0]!.id
  });
  await page.goto(controllerPath('media'));
  await openMediaRules(page, 'fr-CA');
  const drawer = page.locator('dialog[open]');
  const editor = hook(page, 'media-usage-editor');
  for (const scope of ['dossier', 'batch']) {
    await drawer.getByRole('combobox').first().selectOption(scope);
    await expect(hook(page, 'media-usage-suggestion')).toBeVisible();
    for (const channel of ['website', 'facebook'])
      await expect(
        editor.locator(`[data-og7-id="channel:${channel}"]`)
      ).toBeChecked();
    await expect(editor.locator('[data-og7-id="target:openg7"]')).toBeChecked();
    await expect(
      editor.locator('[data-og7-id="target:openg20"]')
    ).not.toBeChecked();
    await expect(hook(page, 'media-usage-evidence')).toHaveValue('');
    await expect(hook(page, 'media-usage-confirmation')).not.toBeChecked();
    await expect(hook(page, 'media-usage-save')).toBeDisabled();
  }
  expect(calls.rules).toEqual([]);
  expect(calls.plans).toEqual([]);
  expect(calls.executes).toEqual([]);
});

for (const scenario of [
  { state: 'withdrawn', channels: [] },
  { state: 'needs_confirmation', channels: ['linkedin'] }
] as const) {
  test(`suggestions preserve an empty destination list for ${scenario.state} permissions`, async ({
    page
  }) => {
    const { state, calls } = await intelligentGalleryFixture(page);
    Object.assign(state, { rules: [] });
    Object.assign(state.assets[1]!, {
      usage: { ...unknownUsage, ...scenario }
    });
    await page.goto(controllerPath('media'));
    await openMediaRules(page, 'fr-CA');
    const editor = hook(page, 'media-usage-editor');
    await expect(hook(page, 'media-usage-suggestion')).toHaveCount(0);
    await expect(
      editor.locator('[data-og7-id^="channel:"]:checked')
    ).toHaveCount(scenario.channels.length);
    if (scenario.channels.length)
      await expect(
        editor.locator('[data-og7-id="channel:linkedin"]')
      ).toBeChecked();
    await expect(
      editor.locator('[data-og7-id^="target:"]:checked')
    ).toHaveCount(0);
    await expect(hook(page, 'media-usage-confirmation')).not.toBeChecked();
    await expect(hook(page, 'media-usage-save')).toBeDisabled();
    expect(calls.rules).toEqual([]);
  });
}
