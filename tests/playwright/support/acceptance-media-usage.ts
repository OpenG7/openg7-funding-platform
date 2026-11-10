import type { Page } from '@playwright/test';
import {
  SPONSOR_MEDIA_USAGE_CHANNELS,
  SPONSOR_MEDIA_USAGE_TARGETS,
  SPONSOR_MEDIA_TRANSFORMATIONS,
  type SponsorMediaUsageRights
} from '@openg7/funding-core';

import { expect } from './test.js';

/** Synthetic images in these journeys come with explicitly chosen usage rights. */
export async function confirmAcceptanceMediaUsage(
  page: Page,
  {
    channels = ['website', 'facebook', 'linkedin'],
    targets = ['openg7'],
    transformations = ['technical'],
    credit = null,
    restrictions = null
  }: Partial<Omit<SponsorMediaUsageRights, 'state'>> = {}
): Promise<void> {
  const editor = page.locator(
    '.media-manager .toolbar [data-og7="media-usage-editor"]'
  );
  await expect(editor).toBeVisible();
  const customize = editor.locator('[data-og7="media-usage-customize"]');
  if (
    !(await customize.evaluate((element: HTMLDetailsElement) => element.open))
  )
    await customize.locator('summary').click();
  for (const channel of SPONSOR_MEDIA_USAGE_CHANNELS)
    await editor
      .locator(`[data-og7-id="channel:${channel}"]`)
      .setChecked(channels.includes(channel));
  for (const target of SPONSOR_MEDIA_USAGE_TARGETS)
    await editor
      .locator(`[data-og7-id="target:${target}"]`)
      .setChecked(targets.includes(target));
  for (const transformation of SPONSOR_MEDIA_TRANSFORMATIONS)
    await editor
      .locator(`[data-og7-id="transform:${transformation}"]`)
      .setChecked(transformations.includes(transformation));
  await editor.locator('[data-og7="media-usage-credit"]').fill(credit ?? '');
  await editor
    .locator('[data-og7="media-usage-restrictions"]')
    .fill(restrictions ?? '');
  await editor.locator('[data-og7="media-usage-confirmation"]').check();
  await expect(
    editor.locator('[data-og7="media-usage-confirmation"]')
  ).toBeChecked();
  await page.locator('[data-og7="media-upload-send"]').click();
}
