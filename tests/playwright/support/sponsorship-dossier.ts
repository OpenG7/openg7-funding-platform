import type { Locator, Page } from '@playwright/test';

import type { AdminController } from './admin-controller.js';
import { expect } from './test.js';

/** Library search, ordering and filters are disclosed only when there are media. */
export async function openMediaLibraryTools(page: Page): Promise<Locator> {
  const tools = page.locator('[data-og7="media-library-tools"]');
  await expect(tools).toBeVisible();
  if ((await tools.getAttribute('open')) === null)
    await tools.locator(':scope > summary').click();
  await expect(tools).toHaveAttribute('open', '');
  return tools;
}

/** Technical metadata and existing analysis stay behind the inspector disclosure. */
export async function openMediaInspectorDetails(page: Page): Promise<Locator> {
  const details = page.locator('[data-og7="media-inspector-details"]');
  await expect(details).toBeVisible();
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
  await expect(details).toHaveAttribute('open', '');
  return details;
}

/** Reach the owning workspace after the individual Publication monitor refactor. */
export async function openPublicationSection(
  page: Page,
  section:
    | 'controls'
    | 'contract'
    | 'navigation'
    | 'obligations'
    | 'offer'
    | 'profile'
    | 'settings'
): Promise<void> {
  const current = new URL(page.url());
  const id =
    current.searchParams.get('sponsorshipId') ??
    current.searchParams.get('workshopSponsorshipId');
  expect(id).toBeTruthy();
  if (section === 'profile' || section === 'settings') {
    await openSponsorshipWebsiteSettings(page);
    return;
  }
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
    await openPublicationAgreement(page);
    return;
  }
  if (current.searchParams.get('tab') !== 'publication')
    await page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
  await expect(page.locator('[data-og7="publication-monitor"]')).toBeVisible();
}

/** Terms belong to Publication and are loaded only on the first disclosure. */
export async function openPublicationAgreement(page: Page): Promise<Locator> {
  const tab = page
    .locator('[data-og7="dossier-tabs"]')
    .getByRole('button', { name: 'Publication', exact: true });
  if ((await tab.getAttribute('aria-current')) !== 'page') await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  const terms = page.locator('[data-og7="publication-terms"]');
  await expect(terms).toBeVisible();
  if ((await terms.getAttribute('open')) === null)
    await terms.locator('[data-og7="publication-terms-toggle"]').click();
  await expect(terms).toHaveAttribute('open', '');
  const editor = terms.locator('[data-og7="admin-commitments"]');
  await expect(editor).toBeVisible();
  return editor;
}

/** Select the exact service before reaching its owner amendment/timing controls. */
export async function openPublicationObligation(
  page: Page,
  obligationId: string
): Promise<Locator> {
  await openPublicationSection(page, 'obligations');
  const row = page.locator(
    `[data-og7="publication-service"][data-og7-id="${obligationId}"]`
  );
  await row.locator('[data-og7="publication-service-details"]').click();
  await page.locator('[data-og7="publication-service-adjust"]').click();
  const editor = page.locator('[data-og7="admin-commitments"]');
  await expect(editor).toBeVisible();
  return editor;
}

/** Settings stay in Fiche et médias; switching tabs preserves local dossier drafts. */
export async function openSponsorshipWebsiteSettings(
  page: Page,
  controller?: AdminController
): Promise<void> {
  const tab = page
    .locator('[data-og7="dossier-tabs"]')
    .getByRole('button', { name: /^(Fiche et médias|Profile & media)$/ });
  if (controller) await controller.activate(tab);
  else await tab.click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('tab') === 'media'
  );
  await expect(tab).toHaveAttribute('aria-current', 'page');
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
