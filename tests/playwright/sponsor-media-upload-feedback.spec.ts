import { expect, test } from './support/test.js';

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
        reviewStatus: 'pending',
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
    '/fonds-des-batisseurs/suivi-commandite?token=e2e-photo-feedback'
  );

  const photoInput = page.getByLabel('Ajouter des photos');
  await expect(photoInput).toBeEnabled();
  await photoInput.setInputFiles({
    name: 'presentation.png',
    mimeType: 'image/png',
    buffer: onePixelPng
  });

  const attempt = page.locator('.media-upload-attempt');
  await expect(attempt).toBeVisible();
  await attempt.scrollIntoViewIfNeeded();
  await expect(
    attempt.getByRole('img', { name: 'Apercu de presentation.png' })
  ).toBeVisible();
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
