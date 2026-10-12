import type { Page } from '@playwright/test';
import type { SponsorMediaUsageRights } from '@openg7/funding-core';

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
  for (const channel of channels)
    await editor.locator(`[data-og7-id="channel:${channel}"]`).check();
  for (const target of targets)
    await editor.locator(`[data-og7-id="target:${target}"]`).check();
  for (const transformation of transformations)
    await editor.locator(`[data-og7-id="transform:${transformation}"]`).check();
  await editor.locator('[data-og7="media-usage-credit"]').fill(credit ?? '');
  await editor
    .locator('[data-og7="media-usage-restrictions"]')
    .fill(restrictions ?? '');
  await editor.locator('[data-og7="media-usage-confirmation"]').check();
  await expect(
    editor.locator('[data-og7="media-usage-confirmation"]')
  ).toBeChecked();
}
