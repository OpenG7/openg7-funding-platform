import type { Locator, Page } from '@playwright/test';

import type { AdminController } from './admin-controller.js';
import { expect } from './test.js';

/** Open the separate historical declaration through its visible disclosure. */
export async function openDeclaredSponsorshipTracking(
  page: Page,
  controller?: AdminController
): Promise<void> {
  const tracking = page.locator('[data-og7="publication-declared-tracking"]');
  const summary = tracking.locator(':scope > summary');
  await expect(summary).toBeVisible();
  if ((await tracking.getAttribute('open')) === null) {
    if (controller) await controller.activate(summary);
    else await summary.click();
  }
  await expect(tracking).toHaveAttribute('open', '');
}

/** The contextual moderation organism is mounted only after opening its tool. */
export async function openSponsorshipModeration(
  page: Page,
  controller?: AdminController
): Promise<Locator> {
  const toggle = page.locator(
    '[data-og7="dossier-tool-toggle"][data-og7-id="moderation"]'
  );
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    if (controller) await controller.activate(toggle);
    else await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const moderation = page
    .locator('[data-og7="dossier-tool-panel"][data-og7-id="moderation"]')
    .locator('[data-og7="moderation-actions"]');
  await expect(moderation).toBeVisible();
  return moderation;
}
