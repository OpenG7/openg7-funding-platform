import { createHash } from 'node:crypto';

import { AxeBuilder } from '@axe-core/playwright';
import sharp from 'sharp';

import { expect, test } from './support/test.js';
import { completeModeration } from './support/moderation.js';
import {
  syntheticPublicationJpeg,
  type PublicationImagePreviewContext as Context
} from './support/publication-image-preview.fixture.js';
import { registerNormalizedPublicationCollectionTests } from './publication-collection-preview.ui.js';

export { syntheticPublicationJpeg };

export function registerPublicationImagePreviewTests(context: Context): void {
  registerNormalizedPublicationCollectionTests(context);
  for (const english of [false, true])
    test(`LinkedIn collection requires every exact private JPEG before approval ${english ? 'EN mobile' : 'FR desktop'}`, async ({
      page
    }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        english ? 'en' : 'fr-CA'
      );
      const first = await syntheticPublicationJpeg();
      const secondBytes = await sharp({
        create: { width: 12, height: 20, channels: 3, background: '#2277bb' }
      })
        .jpeg({ quality: 90 })
        .toBuffer();
      const images = [
        first,
        {
          bytes: secondBytes,
          hash: createHash('sha256').update(secondBytes).digest('hex')
        }
      ];
      const deliveryId = '11111111-1111-4111-8111-111111111111';
      const sponsors = [
        '22222222-2222-4222-8222-222222222222',
        '55555555-5555-4555-8555-555555555555'
      ].map((id, index) => ({
        id,
        name: `Synthetic sponsor ${index + 1}`,
        version: 'sponsor-v1',
        reviewStatus: 'approved' as const,
        paymentStatus: 'paid',
        presentationApproved: true
      }));
      const commands = await context.setup(
        page,
        {
          feedId: 'openg20:linkedin',
          kind: 'sponsorship',
          publicationFormat: 'image_collection',
          mediaId: deliveryId,
          mediaDerivedHash: 'c'.repeat(64),
          mediaImages: images.map((image, index) => ({
            alt: `Authorized collection photograph ${index + 1}`,
            sha256: image.hash,
            width: 12,
            height: 20
          })),
          sponsors
        },
        {}
      );
      let valid = false;
      const indexes: number[] = [];
      await page.route(
        '**/api/admin/publication-automation/image-preview?**',
        (route) => {
          const params = new URL(route.request().url()).searchParams,
            index = Number(params.get('imageIndex'));
          indexes.push(index);
          expect([0, 1]).toContain(index);
          expect(params.get('deliveryId')).toBe(deliveryId);
          return route.fulfill({
            contentType: 'image/jpeg',
            headers: {
              'X-Content-SHA256':
                !valid && index === 1 ? 'b'.repeat(64) : images[index]!.hash,
              'X-Publication-Delivery-Version': params.get('version')!
            },
            body: images[index]!.bytes
          });
        }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + deliveryId
      );
      const dialog = page.getByRole('dialog', {
        name: english ? 'Final publication' : 'Publication finale'
      });
      await expect.poll(() => new Set(indexes).size).toBe(2);
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(
        dialog.locator('[data-og7="publication-collection-preview"] img')
      ).toHaveCount(0);
      const approve = dialog.getByRole('button', {
        name: english ? 'Accept and schedule' : 'Accepter et programmer'
      });
      await expect(approve).toBeDisabled();
      valid = true;
      await dialog
        .getByRole('button', {
          name: english ? 'Close' : 'Fermer',
          exact: true
        })
        .first()
        .click();
      await page.locator('[data-og7-id="' + deliveryId + '"]').click();
      const gallery = dialog.locator(
        '[data-og7="publication-collection-preview"]'
      );
      await expect(gallery.locator('img')).toHaveCount(2);
      await expect(
        gallery.getByRole('img', { name: 'Authorized collection photograph 1' })
      ).toBeVisible();
      await expect(
        gallery.getByRole('img', { name: 'Authorized collection photograph 2' })
      ).toBeVisible();
      expect(new Set(indexes)).toEqual(new Set([0, 1]));
      const displayedHashes = await gallery
        .locator('img')
        .evaluateAll(async (elements) =>
          Promise.all(
            elements.map(async (element) => {
              const bytes = await (
                await fetch((element as HTMLImageElement).src)
              ).arrayBuffer();
              const digest = await crypto.subtle.digest('SHA-256', bytes);
              return Array.from(new Uint8Array(digest), (byte) =>
                byte.toString(16).padStart(2, '0')
              ).join('');
            })
          )
        );
      expect(displayedHashes).toEqual(images.map((image) => image.hash));
      await dialog
        .getByRole('checkbox', { name: english ? /I approve/ : /J’approuve/ })
        .check();
      await expect(approve).toBeEnabled();
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      await approve.focus();
      await page.keyboard.press('Enter');
      await completeModeration(page);
      await expect.poll(() => commands.length).toBe(1);
      expect(commands[0]).toMatchObject({
        action: 'approve',
        id: deliveryId,
        version: 1,
        confirmation: deliveryId
      });
    });
  for (const english of [false, true])
    test(`exact JPEG portrait preview fails closed on changed bytes and preserves owned selections ${english ? 'EN mobile' : 'FR desktop'}`, async ({
      page
    }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        english ? 'en' : 'fr-CA'
      );
      const { bytes, hash } = await syntheticPublicationJpeg();
      const owner = '22222222-2222-4222-8222-222222222222',
        deliveryId = '11111111-1111-4111-8111-111111111111',
        assetId = '44444444-4444-4444-8444-444444444444';
      const photos = [
        { contributionId: owner, assetId, assetVersion: 'photo-v1' }
      ];
      const commands = await context.setup(
        page,
        {
          kind: 'sponsorship',
          batchId: '33333333-3333-4333-8333-333333333333',
          publicationFormat: 'individual_portrait',
          photoSelections: photos,
          mediaId: deliveryId,
          mediaDerivedHash: hash,
          mediaAlt: 'Owned final portrait',
          sponsors: [
            {
              id: owner,
              name: 'Atelier synthétique',
              version: 'sponsor-v1',
              reviewStatus: 'approved',
              paymentStatus: 'paid',
              presentationApproved: true
            }
          ]
        },
        {
          [owner]: [
            {
              id: assetId,
              contributionId: owner,
              version: 'photo-v1',
              kind: 'supporting_image',
              transformations: ['technical', 'portrait'],
              company: 'Atelier synthétique',
              alt: 'Owned source photograph',
              url: '/api/public/sponsor-media/' + assetId,
              credit: null
            }
          ]
        }
      );
      let valid = false;
      const previews: { deliveryId: string | null; version: string | null }[] =
        [];
      await page.route(
        '**/api/admin/publication-automation/image-preview?**',
        async (route) => {
          const url = new URL(route.request().url());
          previews.push({
            deliveryId: url.searchParams.get('deliveryId'),
            version: url.searchParams.get('version')
          });
          return route.fulfill({
            contentType: 'image/jpeg',
            headers: {
              'X-Content-SHA256': valid ? hash : 'b'.repeat(64),
              'X-Publication-Delivery-Version': url.searchParams.get('version')!
            },
            body: bytes
          });
        }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + deliveryId
      );
      const dialog = page.getByRole('dialog', {
        name: english ? 'Final publication' : 'Publication finale'
      });
      await expect.poll(() => previews.length).toBe(1);
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(
        dialog.getByRole('img', { name: 'Owned final portrait' })
      ).toHaveCount(0);
      const approve = dialog.getByRole('button', {
        name: english ? 'Accept and schedule' : 'Accepter et programmer'
      });
      await expect(approve).toBeDisabled();
      expect(commands).toHaveLength(0);
      valid = true;
      await dialog
        .getByRole('button', {
          name: english ? 'Close' : 'Fermer',
          exact: true
        })
        .first()
        .click();
      await page.locator('[data-og7-id="' + deliveryId + '"]').click();
      await expect(
        dialog.getByRole('img', { name: 'Owned final portrait' })
      ).toBeVisible();
      await expect(
        dialog.locator('[data-og7="publication-image-preparation"]')
      ).toContainText(english ? 'Exact JPEG' : 'JPEG exact');
      await dialog
        .getByRole('button', {
          name: english ? 'Edit' : 'Modifier',
          exact: true
        })
        .click();
      await expect(dialog.locator('select[name="media"]')).toHaveCount(0);
      const photo = dialog.locator(
        '[data-og7-id="publication-photo:' + owner + '"]'
      );
      await expect(photo).toHaveValue(assetId);
      await expect(photo.locator('option[value="foreign-photo"]')).toHaveCount(
        0
      );
      await dialog
        .locator('textarea[name="message"]')
        .fill('Complete exact portrait caption, explicitly edited.');
      await dialog
        .getByRole('button', {
          name: english ? 'Save draft' : 'Enregistrer le brouillon'
        })
        .click();
      await expect.poll(() => commands.length).toBe(1);
      expect(commands[0]).toMatchObject({
        action: 'edit',
        version: 1,
        mediaId: null,
        publicationFormat: 'individual_portrait',
        photoSelections: photos
      });
      expect(
        previews.every(
          (preview) =>
            preview.deliveryId === deliveryId &&
            ['1', '2'].includes(preview.version ?? '')
        )
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
    });
  for (const english of [false, true])
    test(`exact JPEG batch portrait waits for an explicit owned photo before fresh approval ${english ? 'EN mobile' : 'FR desktop'}`, async ({
      page
    }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        english ? 'en' : 'fr-CA'
      );
      const { bytes, hash } = await syntheticPublicationJpeg();
      const owner = '22222222-2222-4222-8222-222222222222',
        deliveryId = '11111111-1111-4111-8111-111111111111',
        batchId = '33333333-3333-4333-8333-333333333333',
        assetId = '44444444-4444-4444-8444-444444444444';
      const commands = await context.setup(
        page,
        {
          kind: 'sponsorship',
          mediaDerivedHash: hash,
          mediaAlt: 'Selected exact portrait',
          sponsors: [
            {
              id: owner,
              name: 'Atelier synthétique',
              version: 'sponsor-v1',
              reviewStatus: 'approved',
              paymentStatus: 'paid',
              presentationApproved: true
            }
          ]
        },
        {
          [owner]: [
            {
              id: assetId,
              contributionId: owner,
              version: 'photo-v1',
              kind: 'supporting_image',
              transformations: ['technical', 'portrait'],
              company: 'Atelier synthétique',
              alt: 'Explicit owned photograph',
              url: '/api/public/sponsor-media/' + assetId
            }
          ]
        },
        true
      );
      await page.route('**/api/admin/publication-batches?**', (route) => {
        expect(new URL(route.request().url()).searchParams.get('batchId')).toBe(
          batchId
        );
        return route.fulfill({
          json: {
            data_source: 'database',
            batches: [
              { id: batchId, publicationFormat: 'individual_portrait' }
            ],
            last_updated_at: '2030-06-01T12:00:00Z'
          }
        });
      });
      const previews: number[] = [];
      await page.route(
        '**/api/admin/publication-automation/image-preview?**',
        (route) => {
          const params = new URL(route.request().url()).searchParams;
          expect(params.get('deliveryId')).toBe(deliveryId);
          previews.push(Number(params.get('version')));
          return route.fulfill({
            contentType: 'image/jpeg',
            headers: {
              'X-Content-SHA256': hash,
              'X-Publication-Delivery-Version': params.get('version')!
            },
            body: bytes
          });
        }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?batchId=' +
          batchId +
          '&feedId=openg7:facebook'
      );
      const dialog = page.getByRole('dialog', {
        name: english ? 'Final publication' : 'Publication finale'
      });
      await expect(dialog).toBeVisible();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({
        action: 'compose',
        feedId: 'openg7:facebook',
        kind: 'sponsorship',
        batchId,
        publicationFormat: 'individual_portrait'
      });
      await dialog
        .getByRole('checkbox', { name: english ? /I approve/ : /J’approuve/ })
        .check();
      const approve = dialog.getByRole('button', {
        name: english ? 'Accept and schedule' : 'Accepter et programmer'
      });
      await expect(approve).toBeDisabled();
      expect(previews).toEqual([]);
      await dialog
        .getByRole('button', {
          name: english ? 'Edit' : 'Modifier',
          exact: true
        })
        .click();
      await expect(
        dialog.locator('[data-og7="publication-format"]')
      ).toHaveValue('individual_portrait');
      const photo = dialog.locator(
        '[data-og7-id="publication-photo:' + owner + '"]'
      );
      await expect(photo).toHaveValue('');
      const save = dialog.getByRole('button', {
        name: english ? 'Save draft' : 'Enregistrer le brouillon'
      });
      await expect(save).toBeDisabled();
      await photo.selectOption(assetId);
      await save.click();
      await expect.poll(() => commands.length).toBe(2);
      expect(commands[1]).toMatchObject({
        action: 'edit',
        version: 1,
        mediaId: null,
        publicationFormat: 'individual_portrait',
        photoSelections: [
          { contributionId: owner, assetId, assetVersion: 'photo-v1' }
        ]
      });
      await expect(
        dialog.getByRole('img', { name: 'Selected exact portrait' })
      ).toBeVisible();
      expect(previews).toEqual([2]);
      await dialog
        .getByRole('checkbox', { name: english ? /I approve/ : /J’approuve/ })
        .check();
      await approve.click();
      await completeModeration(page);
      await expect.poll(() => commands.length).toBe(3);
      expect(commands[2]).toMatchObject({
        action: 'approve',
        id: deliveryId,
        version: 2,
        confirmation: deliveryId,
        moderationDecision: {
          level: 'N0',
          contentVersion: 3,
          contentFingerprint: 'a'.repeat(64),
          confirmation: deliveryId
        }
      });
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
    });
}
