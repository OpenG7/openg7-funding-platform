import type { Page } from '@playwright/test';
import type { SponsorMediaAsset } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

test.use({ ignoreHTTPSErrors: true });

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('@mobile keeps a failed photo preview visible until it is removed', async ({
  page
}) => {
  await page.route('**/api/sponsorship-followup**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.endsWith('/draft')) {
      await route.fulfill({
        json: { revision: 0, data: null, updatedAt: null }
      });
      return;
    }

    if (url.pathname.endsWith('/media') && request.method() === 'POST') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Payment for this sponsorship is not confirmed yet.'
        })
      });
      return;
    }

    if (url.pathname.endsWith('/media') && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          assets: [],
          limits: {
            maxUploadBytes: 8 * 1024 * 1024,
            maxSupportingImages: 5,
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
          }
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        found: true,
        publicReference: 'CMD-E2E-PHOTO',
        paymentStatus: 'paid',
        reviewStatus: 'pending_review',
        amount: 250,
        currency: 'CAD',
        paidAt: '2026-07-31T12:00:00.000Z',
        sponsorshipTier: null,
        sponsorshipBenefits: [],
        detailsSubmitted: true,
        companyName: 'Atelier Photo',
        contactName: 'Camille Tremblay',
        contactEmail: 'camille@example.test',
        websiteUrl: null,
        logoUrl: null,
        message: null,
        reviewedAt: null
      })
    });
  });

  await page.goto(
    '/fonds-des-batisseurs/suivi-commandite?token=e2e-photo-feedback-fixture-local-only-000000'
  );

  const photoInput = page.getByLabel('Ajouter des photos');
  await expect(photoInput).toBeEnabled();
  await photoInput.setInputFiles({
    name: 'presentation.png',
    mimeType: 'image/png',
    buffer: onePixelPng
  });

  const attempt = page.locator('[data-og7="media-upload-attempt"]');
  await expect(attempt).toBeVisible();
  await attempt.scrollIntoViewIfNeeded();
  const preview = attempt.getByRole('img', {
    name: /Aper.u de presentation.png/
  });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBeGreaterThan(0);
  await expect(attempt.getByRole('alert')).toContainText(
    /paiement de cette commandite n'est pas encore confirm/i
  );

  const removeButton = attempt.getByRole('button', {
    name: 'Retirer presentation.png'
  });
  await expect(removeButton).toBeEnabled();

  const attemptBox = await attempt.boundingBox();
  const removeButtonBox = await removeButton.boundingBox();
  expect(attemptBox).not.toBeNull();
  expect(removeButtonBox).not.toBeNull();
  expect(removeButtonBox!.x + removeButtonBox!.width).toBeLessThanOrEqual(
    attemptBox!.x + attemptBox!.width
  );

  await removeButton.click();
  await expect(attempt).toHaveCount(0);
});

async function mockConfirmedUpload(page: Page) {
  const uploaded: SponsorMediaAsset = {
    id: 'synthetic-uploaded-photo',
    contributionId: 'synthetic-sponsorship',
    kind: 'supporting_image',
    reviewStatus: 'pending_review',
    uploadedBy: 'sponsor',
    originalFilename: 'presentation.png',
    originalMimeType: 'image/png',
    originalSizeBytes: onePixelPng.length,
    processedMimeType: 'image/webp',
    processedSizeBytes: onePixelPng.length,
    width: 1,
    height: 1,
    altText: 'Synthetic presentation',
    sortOrder: 0,
    publicUrl: null,
    reviewedAt: null,
    version: 'synthetic-media-version-1',
    createdAt: '2026-09-18T12:00:00Z'
  };
  const state = {
    failReads: true,
    posts: 0,
    deletions: [] as unknown[],
    assets: [] as SponsorMediaAsset[]
  };
  await page.route('**/api/sponsorship-followup**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/draft')) {
      await route.fulfill({
        json: { revision: 0, data: null, updatedAt: null }
      });
    } else if (pathname.includes('/media/content/')) {
      await route.fulfill({ contentType: 'image/png', body: onePixelPng });
    } else if (pathname.endsWith('/media/delete')) {
      state.deletions.push(request.postDataJSON());
      state.assets = [];
      await route.fulfill({ json: { deleted: true, assetId: uploaded.id } });
    } else if (pathname.endsWith('/media') && request.method() === 'POST') {
      state.posts++;
      state.assets = [uploaded];
      await route.fulfill({ json: { uploaded: true, asset: uploaded } });
    } else if (pathname.endsWith('/media')) {
      if (state.posts && state.failReads)
        await route.fulfill({
          status: 503,
          json: { error: 'Synthetic failure' }
        });
      else
        await route.fulfill({
          json: {
            assets: state.assets,
            limits: {
              maxUploadBytes: 8 * 1024 * 1024,
              maxSupportingImages: 2,
              acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
            }
          }
        });
    } else {
      await route.fulfill({
        json: {
          found: true,
          publicReference: 'CMD-SYNTHETIC-UPLOAD',
          paymentStatus: 'paid',
          reviewStatus: 'pending_review',
          amount: 250,
          currency: 'CAD',
          paidAt: '2026-09-18T12:00:00Z',
          sponsorshipTier: null,
          sponsorshipBenefits: [],
          detailsSubmitted: true,
          companyName: 'Synthetic company',
          contactName: 'Camille',
          contactEmail: 'camille@example.test',
          websiteUrl: null,
          logoUrl: null,
          message: null,
          reviewedAt: null
        }
      });
    }
  });
  return { state, uploaded };
}

for (const english of [false, true])
  test(
    'confirmed upload remains saved after failed reread with per-file feedback ' +
      (english ? 'EN @mobile' : 'FR'),
    async ({ page }) => {
      const { state } = await mockConfirmedUpload(page);
      await page.goto(
        (english ? '/en' : '') +
          '/fonds-des-batisseurs/suivi-commandite?token=e2e-confirmed-media-fixture-local-only-000001'
      );
      const input = page.getByLabel(
        english ? 'Add photos' : 'Ajouter des photos'
      );
      await expect(input).toBeEnabled();
      await input.setInputFiles([
        {
          name: 'presentation.png',
          mimeType: 'image/png',
          buffer: onePixelPng
        },
        { name: 'unsupported.gif', mimeType: 'image/gif', buffer: onePixelPng }
      ]);
      const attempts = page.locator('[data-og7="media-upload-attempt"]');
      await expect(attempts).toHaveCount(2);
      await expect(
        attempts.filter({ hasText: 'presentation.png' })
      ).toContainText(english ? 'Upload successful' : 'Téléversement réussi');
      await expect(
        attempts.filter({ hasText: 'unsupported.gif' })
      ).toContainText(
        english ? 'valid JPEG, PNG or WebP' : 'JPEG, PNG ou WebP valide'
      );
      await expect(
        page.locator('[data-og7="followup-photo-count"]')
      ).toContainText('1 / 2');
      await expect(input).toBeDisabled();
      expect(state.posts).toBe(1);
      state.failReads = false;
      const retry = page.getByRole('button', {
        name: english ? 'Try again' : 'Réessayer',
        exact: true
      });
      await retry.focus();
      await retry.press('Enter');
      await expect(page.locator('[data-og7="followup-media"]')).toHaveCount(1);
      await expect(attempts).toHaveCount(1);
      await expect(input).toBeEnabled();
      expect(state.posts).toBe(1);
    }
  );

test('uploaded attempt requires explicit deletion confirmation and sends the saved version after failed reread', async ({
  page
}) => {
  const { state, uploaded } = await mockConfirmedUpload(page);
  const token = 'e2e-delete-media-fixture-local-only-0000000001';
  await page.goto('/fonds-des-batisseurs/suivi-commandite?token=' + token);
  const input = page.getByLabel('Ajouter des photos');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: 'presentation.png',
    mimeType: 'image/png',
    buffer: onePixelPng
  });
  const attempt = page.locator('[data-og7="media-upload-attempt"]');
  await expect(attempt).toContainText('Téléversement réussi');
  const remove = attempt.getByRole('button', {
    name: 'Retirer presentation.png'
  });
  page.once('dialog', (dialog) => dialog.dismiss());
  await remove.click();
  await expect(attempt).toHaveCount(1);
  expect(state.deletions).toEqual([]);
  page.once('dialog', (dialog) => dialog.accept());
  await remove.focus();
  await remove.press('Enter');
  await expect(attempt).toHaveCount(0);
  expect(state.deletions).toEqual([
    {
      token,
      assetId: uploaded.id,
      expectedVersion: uploaded.version,
      confirmed: true
    }
  ]);
  await expect(page.locator('[data-og7="followup-photo-count"]')).toContainText(
    '0 / 2'
  );
});
