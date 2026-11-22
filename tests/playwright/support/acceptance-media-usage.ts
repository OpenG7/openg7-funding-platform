import type { Locator, Page } from '@playwright/test';
import {
  SPONSOR_MEDIA_USAGE_CHANNELS,
  SPONSOR_MEDIA_USAGE_TARGETS,
  SPONSOR_MEDIA_TRANSFORMATIONS,
  type SponsorMediaUsageRights
} from '@openg7/funding-core';

import { expect } from './test.js';

/** Saved media actions stay compact until the sponsor opens their disclosure. */
export async function openAcceptanceMediaActions(
  page: Page,
  media: Locator = page.locator('[data-og7="followup-media"]').first()
): Promise<void> {
  const details = media.locator('[data-og7="media-item-details"]');
  await expect(details).toBeVisible();
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open)))
    await details.locator(':scope > summary').click();
}

/** Upload consent accepts the public journey's existing initial website scope. */
export async function confirmAcceptanceMediaUsage(page: Page): Promise<void> {
  const selection = page.locator('[data-og7="media-upload-selection"]');
  const confirmation = selection.locator(
    '[data-og7="media-usage-confirmation"]'
  );
  await expect(confirmation).toBeVisible();
  await confirmation.check();
  await expect(confirmation).toBeChecked();
  await selection.locator('[data-og7="media-upload-send"]').click();
}

/** Broader synthetic usage is explicitly accepted through the saved file's UI. */
export async function updateAcceptanceMediaUsage(
  page: Page,
  filename: string,
  {
    channels = ['website'],
    targets = ['openg7'],
    transformations = ['technical'],
    credit = null,
    restrictions = null
  }: Partial<Omit<SponsorMediaUsageRights, 'state'>> = {}
): Promise<void> {
  const media = page.locator('[data-og7="followup-media"]').filter({
    has: page.getByText(filename, { exact: true })
  });
  await expect(media).toBeVisible();
  await openAcceptanceMediaActions(page, media);
  const disclosure = media.locator('[data-og7="followup-media-rights"]');
  if (
    !(await disclosure.evaluate((element: HTMLDetailsElement) => element.open))
  )
    await disclosure.locator(':scope > summary').click();
  const editor = disclosure.locator('[data-og7="media-usage-editor"]');
  await expect(editor).toBeVisible();
  const customize = editor.locator('[data-og7="media-usage-customize"]');
  if (
    !(await customize.evaluate((element: HTMLDetailsElement) => element.open))
  )
    await customize.locator(':scope > summary').click();
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
  const confirmation = editor.locator('[data-og7="media-usage-confirmation"]');
  await confirmation.check();
  await expect(confirmation).toBeChecked();
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sponsorship-followup/media/usage') &&
      response.request().method() === 'POST'
  );
  await editor.locator('[data-og7="media-usage-save"]').click();
  const response = await completed;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(
    page.locator('[data-og7="followup-media-consent"]')
  ).toHaveAttribute('aria-busy', 'false');
  await expect(confirmation).not.toBeChecked();
}
