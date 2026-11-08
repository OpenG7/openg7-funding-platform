import type { Locator, Page } from '@playwright/test';

import type { AdminController } from './admin-controller.js';
import { expect } from './test.js';

/** Reach the owning workspace after the individual Publication monitor refactor. */
export async function openPublicationSection(
  page: Page,
  section: 'controls' | 'contract' | 'navigation' | 'obligations' | 'offer'
): Promise<void> {
  const current = new URL(page.url());
  const id =
    current.searchParams.get('sponsorshipId') ??
    current.searchParams.get('workshopSponsorshipId');
  expect(id).toBeTruthy();
  if (section === 'controls') {
    if (
      current.pathname !== '/admin/fundraiser/preflight' ||
      current.searchParams.get('view') !== 'publication'
    )
      await page.goto(
        `/admin/fundraiser/preflight?view=publication&workshopSponsorshipId=${id}&publicationReturn=${id}`
      );
    await expect(page.locator('[data-og7="publication-owner"]')).toBeVisible();
    return;
  }
  if (section === 'contract' || section === 'offer') {
    await page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: /^(Aperçu|Overview)$/ })
      .click();
    await expect(page.locator('#dossier-agreement')).toBeVisible();
    return;
  }
  if (current.searchParams.get('tab') !== 'publication')
    await page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
  await expect(page.locator('[data-og7="publication-monitor"]')).toBeVisible();
}

/** Settings stay in Fiche et médias; switching tabs preserves local dossier drafts. */
export async function openSponsorshipWebsiteSettings(
  page: Page,
  controller?: AdminController
): Promise<void> {
  const current = new URL(page.url());
  if (current.searchParams.get('tab') !== 'media') {
    const tab = page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: /^(Fiche et médias|Profile & media)$/ });
    if (controller) await controller.activate(tab);
    else await tab.click();
  }
  const settings = page.locator('[data-og7="publication-advanced"]');
  await expect(settings).toBeVisible();
  if ((await settings.getAttribute('open')) === null) {
    const summary = settings.locator(':scope > summary');
    if (controller) await controller.activate(summary);
    else await summary.click();
  }
}

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
