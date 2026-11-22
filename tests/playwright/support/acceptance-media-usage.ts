import { randomUUID } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';
import {
  getSponsorMediaUsageTerms,
  type SponsorMediaAsset,
  type SponsorMediaUsageRequest,
  type SponsorMediaUsageRights,
  type SponsorshipMediaResponse
} from '@openg7/funding-core';

import { acceptanceComposeArgs } from './acceptance-database.js';
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

/**
 * Seed broader publication rights through the public API in the disposable recipe.
 * This fixture is separate from the upload's UI acceptance; it does not exercise
 * a sponsor-facing editor for saved files.
 */
export async function setupAcceptanceMediaUsageViaApi(
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
  acceptanceComposeArgs();
  const pageUrl = new URL(page.url());
  const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
  if (
    !configuredBaseUrl ||
    pageUrl.origin !== new URL(configuredBaseUrl).origin ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(pageUrl.hostname)
  )
    throw new Error(
      'Synthetic media usage requires the disposable Web origin.'
    );

  const token = await page.evaluate(
    () =>
      new URL(window.location.href).searchParams.get('token') ||
      window.sessionStorage.getItem('openg7-sponsorship-followup-token') ||
      ''
  );
  if (!token)
    throw new Error(
      'Synthetic media usage requires a current follow-up token.'
    );

  const endpoint = new URL('/api/sponsorship-followup/media', pageUrl.origin);
  const snapshotResponse = await page.request.get(endpoint.href, {
    params: { token }
  });
  expect(
    snapshotResponse.ok(),
    `Synthetic media snapshot failed (${snapshotResponse.status()}).`
  ).toBe(true);
  const snapshot = (await snapshotResponse.json()) as SponsorshipMediaResponse;
  const matches = snapshot.assets.filter(
    (asset) => asset.originalFilename === filename
  );
  expect(matches).toHaveLength(1);
  const asset = matches[0]!;
  expect(asset.usage?.state).toBe('confirmed');
  expect(asset.usageAcceptance?.source).toBe('platform_acceptance');
  const { version, fingerprint, locale } = getSponsorMediaUsageTerms(
    asset.usageAcceptance!.locale
  );
  const payload: SponsorMediaUsageRequest = {
    token,
    requestId: randomUUID(),
    assetId: asset.id,
    expectedVersion: asset.version,
    confirmed: true,
    usage: {
      state: 'confirmed',
      channels,
      targets,
      transformations,
      credit,
      restrictions
    },
    termsAcceptance: { version, fingerprint, locale, accepted: true }
  };
  const response = await page.request.post(endpoint.href + '/usage', {
    headers: { Origin: pageUrl.origin },
    data: payload
  });
  expect(
    response.ok(),
    `Synthetic media setup failed (${response.status()}).`
  ).toBe(true);
  const result = (await response.json()) as {
    updated: true;
    asset: SponsorMediaAsset;
  };
  expect(result.updated).toBe(true);
  expect(result.asset.id).toBe(asset.id);
  expect(result.asset.usage).toEqual(payload.usage);

  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === endpoint.pathname &&
      response.request().method() === 'GET'
  );
  await page
    .getByRole('button', {
      name: locale === 'en' ? 'Refresh status' : 'Actualiser le statut',
      exact: true
    })
    .click();
  const refreshedResponse = await refreshed;
  expect(refreshedResponse.ok()).toBe(true);
  const current = (await refreshedResponse.json()) as SponsorshipMediaResponse;
  expect(current.assets.find((item) => item.id === asset.id)?.version).toBe(
    result.asset.version
  );
  await expect(
    page.locator('[data-og7="followup-media-consent"]')
  ).toHaveAttribute('aria-busy', 'false');
}
