import {
  normalizedPublicationCollection,
  type PublicationImagePreviewContext
} from './support/publication-image-preview.fixture.js';
import { expect, test } from './support/test.js';
import { completeModeration } from './support/moderation.js';

export function registerNormalizedPublicationCollectionTests(
  context: PublicationImagePreviewContext
): void {
  for (const english of [false, true])
    test(`ten normalized collection JPEGs decode in owner order before one exact approval ${english ? 'EN mobile' : 'FR desktop'}`, async ({
      page
    }) => {
      const images = await normalizedPublicationCollection();
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        english ? 'en' : 'fr-CA'
      );
      const deliveryId = '11111111-1111-4111-8111-111111111111';
      const owners = images.map((_, index) => ({
        id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
        name: `Synthetic owner ${String(index + 1).padStart(2, '0')}`,
        assetId: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
        assetVersion: `photo-v${index + 1}`
      }));
      const mediaImages = images.map((image, index) => ({
        alt: `Authorized photograph for ${owners[index]!.name}`,
        sha256: image.hash,
        width: 2000,
        height: 1333
      }));
      const commands = await context.setup(
        page,
        {
          feedId: 'openg20:linkedin',
          kind: 'sponsorship',
          batchId: '33333333-3333-4333-8333-333333333333',
          publicationFormat: 'image_collection',
          photoSelections: owners.map((owner) => ({
            contributionId: owner.id,
            assetId: owner.assetId,
            assetVersion: owner.assetVersion
          })),
          mediaId: deliveryId,
          mediaDerivedHash: 'c'.repeat(64),
          mediaImages,
          sponsors: owners.map((owner) => ({
            id: owner.id,
            name: owner.name,
            version: 'sponsor-v1',
            reviewStatus: 'approved' as const,
            paymentStatus: 'paid',
            presentationApproved: true
          }))
        },
        Object.fromEntries(
          owners.map((owner, index) => [
            owner.id,
            [
              {
                id: owner.assetId,
                contributionId: owner.id,
                version: owner.assetVersion,
                kind: 'supporting_image',
                transformations: ['technical'],
                company: owner.name,
                alt: mediaImages[index]!.alt,
                url: '/api/public/sponsor-media/' + owner.assetId,
                credit: null
              }
            ]
          ])
        )
      );
      const requestedIndexes = new Set<number>();
      const completedIndexes = new Set<number>();
      let releaseLastResponse = () => {};
      const lastResponse = new Promise<void>((resolve) => {
        releaseLastResponse = resolve;
      });
      await page.route(
        '**/api/admin/publication-automation/image-preview?**',
        async (route) => {
          const params = new URL(route.request().url()).searchParams;
          const index = Number(params.get('imageIndex'));
          expect(Number.isInteger(index) && index >= 0 && index < 10).toBe(
            true
          );
          expect(params.get('deliveryId')).toBe(deliveryId);
          const version = params.get('version');
          if (version === '2') {
            expect(commands).toHaveLength(1);
            expect(commands[0]).toMatchObject({
              action: 'approve',
              id: deliveryId,
              version: 1,
              confirmation: deliveryId,
              moderationDecision: {
                level: 'N0',
                confirmation: deliveryId
              }
            });
          } else expect(version).toBe('1');
          requestedIndexes.add(index);
          if (index === 9) await lastResponse;
          await route.fulfill({
            contentType: 'image/jpeg',
            headers: {
              'X-Content-SHA256': images[index]!.hash,
              'X-Publication-Delivery-Version': version!
            },
            body: images[index]!.bytes
          });
          completedIndexes.add(index);
        }
      );
      try {
        await page.goto(
          '/admin/fundraiser/publications/automation?deliveryId=' + deliveryId
        );
        const dialog = page.getByRole('dialog', {
          name: english ? 'Final publication' : 'Publication finale'
        });
        await expect(dialog).toBeVisible();
        await expect.poll(() => requestedIndexes.size).toBe(10);
        await expect.poll(() => completedIndexes.size).toBe(9);
        await dialog
          .getByRole('checkbox', { name: english ? /I approve/ : /J’approuve/ })
          .check();
        const approve = dialog.getByRole('button', {
          name: english ? 'Accept and schedule' : 'Accepter et programmer'
        });
        await expect(approve).toBeDisabled();
        expect(commands).toHaveLength(0);
        await dialog
          .getByRole('button', {
            name: english ? 'Edit' : 'Modifier',
            exact: true
          })
          .click();
        const selections = dialog.locator(
          'select[data-og7-id^="publication-photo:"]'
        );
        await expect(selections).toHaveCount(10);
        for (const owner of owners) {
          const selection = dialog.locator(
            `[data-og7-id="publication-photo:${owner.id}"]`
          );
          await expect(selection).toHaveValue(owner.assetId);
          await expect(selection.locator('option')).toHaveCount(2);
          await expect(
            selection.locator(`option[value="${owner.assetId}"]`)
          ).toHaveText(`Authorized photograph for ${owner.name}`);
        }
        const gallery = dialog.locator(
          '[data-og7="publication-collection-preview"]'
        );
        await expect(gallery.locator('img')).toHaveCount(0);
        await expect(approve).toBeDisabled();
        expect(commands).toHaveLength(0);
        releaseLastResponse();
        await expect.poll(() => completedIndexes.size).toBe(10);
        await expect(gallery.locator('img')).toHaveCount(10);
        const displayed = await gallery
          .locator('img')
          .evaluateAll(async (elements) =>
            Promise.all(
              elements.map(async (element) => {
                const image = element as HTMLImageElement;
                await image.decode();
                const bytes = await (await fetch(image.src)).arrayBuffer();
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                return {
                  alt: image.alt,
                  complete: image.complete,
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                  hash: Array.from(new Uint8Array(digest), (byte) =>
                    byte.toString(16).padStart(2, '0')
                  ).join('')
                };
              })
            )
          );
        expect(displayed).toEqual(
          mediaImages.map((image) => ({
            alt: image.alt,
            complete: true,
            width: 2000,
            height: 1333,
            hash: image.sha256
          }))
        );
        for (const [index, owner] of owners.entries()) {
          const image = gallery.locator('img').nth(index);
          await image.scrollIntoViewIfNeeded();
          await expect(image).toBeVisible();
          await expect(image).toBeInViewport();
          await expect(image).toHaveAttribute(
            'alt',
            `Authorized photograph for ${owner.name}`
          );
        }
        // Product approval waits for every verified Blob. Decode is observed
        // here before the human click; it is not a separate product-side gate.
        await expect(approve).toBeEnabled();
        expect(commands).toHaveLength(0);
        await approve.focus();
        await page.keyboard.press('Enter');
        await completeModeration(page);
        await expect.poll(() => commands.length).toBe(1);
        expect(commands[0]).toMatchObject({
          action: 'approve',
          id: deliveryId,
          version: 1,
          confirmation: deliveryId,
          moderationDecision: {
            level: 'N0',
            confirmation: deliveryId
          }
        });
        expect(commands.some((command) => command.action === 'worker')).toBe(
          false
        );
      } finally {
        releaseLastResponse();
      }
    });
}
