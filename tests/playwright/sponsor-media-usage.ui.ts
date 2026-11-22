import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { getSponsorMediaUsageTerms } from '@openg7/funding-core';
import type {
  SponsorMediaAsset,
  SponsorMediaPreference,
  SponsorMediaUsageRights
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  json,
  mock,
  path,
  token,
  visit
} from './support/sponsorship-followup.js';
import {
  confirmAcceptanceMediaUsage,
  openAcceptanceMediaActions
} from './support/acceptance-media-usage.js';
import { createMediaWorkspaceFixture } from './media-review-workspace/fixture.js';

const id = '10000000-0000-4000-8000-000000000402';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const rights: SponsorMediaUsageRights = {
  state: 'confirmed',
  channels: ['website', 'facebook'],
  targets: ['openg7'],
  transformations: ['technical', 'portrait'],
  credit: 'Photo : Atelier synthétique',
  restrictions: null
};
const unknown: SponsorMediaUsageRights = {
  state: 'needs_confirmation',
  channels: [],
  targets: [],
  transformations: [],
  credit: null,
  restrictions: null
};
const asset = (): SponsorMediaAsset => ({
  id,
  contributionId: '10000000-0000-4000-8000-000000000401',
  kind: 'supporting_image',
  reviewStatus: 'pending_review',
  uploadedBy: 'sponsor',
  originalFilename: 'synthetic.png',
  originalMimeType: 'image/png',
  originalSizeBytes: png.length,
  processedMimeType: 'image/webp',
  processedSizeBytes: png.length,
  width: 1,
  height: 1,
  altText: 'Owned synthetic photograph',
  sortOrder: 0,
  publicUrl: null,
  reviewedAt: null,
  version: 'v1',
  createdAt: '2026-10-11T12:00:00Z',
  usage: rights,
  usageRestrictionsReviewed: false
});
async function privateMedia(
  page: Page,
  initialAssets: readonly SponsorMediaAsset[] = [],
  maxUploadBytes = 1024
) {
  await mock(page);
  const state = {
    assets: [...initialAssets],
    preference: {
      revision: 0,
      preferredAssetId: null,
      correction: null,
      state: 'none',
      sponsorExplanation: null,
      available: true
    } as SponsorMediaPreference,
    commands: [] as Record<string, unknown>[],
    uploads: [] as string[],
    uploadFailure: false,
    receiptUnavailable: false,
    receiptChecks: 0,
    failure: false,
    conflict: false
  };
  await page.route('**/api/sponsorship-followup/media**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname.includes('/content/'))
      return route.fulfill({ contentType: 'image/png', body: png });
    if (url.pathname.endsWith('/upload-receipt')) {
      state.receiptChecks++;
      expect(url.searchParams.has('token')).toBe(false);
      expect(req.headers()['x-sponsorship-followup-token']).toBeTruthy();
      return state.receiptUnavailable
        ? json(route, { code: 'MEDIA_UPLOAD_RECEIPT_UNAVAILABLE' }, 503)
        : json(route, { found: false });
    }
    if (req.method() === 'GET')
      return json(route, {
        assets: state.assets,
        preference: state.preference,
        limits: {
          maxUploadBytes,
          maxSupportingImages: 3,
          acceptedMimeTypes: ['image/png']
        }
      });
    if (
      url.pathname.endsWith('/usage') ||
      url.pathname.endsWith('/preference')
    ) {
      const payload = req.postDataJSON();
      state.commands.push(payload);
      if (state.conflict) {
        state.conflict = false;
        state.assets = state.assets.map((item) => ({ ...item, version: 'v2' }));
        return json(route, { code: 'VERSION_CONFLICT' }, 409);
      }
      if (state.failure)
        return json(route, { code: 'MEDIA_USAGE_UNAVAILABLE' }, 503);
      if (url.pathname.endsWith('/usage')) {
        state.assets = state.assets.map((item) =>
          item.id === payload.assetId
            ? {
                ...item,
                usage: payload.usage,
                version: item.version === 'v1' ? 'v2' : 'v3',
                reviewStatus: 'pending_review',
                publicUrl: null
              }
            : item
        );
        return json(route, { updated: true, asset: state.assets[0] });
      }
      state.preference = {
        revision: 1,
        preferredAssetId: payload.assetId,
        correction: payload.correction,
        state: 'pending',
        sponsorExplanation: null,
        available: true
      };
      return json(route, { updated: true, preference: state.preference });
    }
    state.uploads.push(req.postDataBuffer()!.toString('utf8'));
    if (state.uploadFailure)
      return json(route, { code: 'MEDIA_UPLOAD_UNAVAILABLE' }, 503);
    state.assets = [asset()];
    return json(route, { asset: state.assets[0] });
  });
  return state;
}
export function registerPrivateMediaUsageTests(): void {
  for (const english of [false, true]) {
    const suffix = english ? 'EN mobile @mobile' : 'FR desktop';
    const viewport = (page: Page) =>
      page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
    test(`image usage enforces the 3 MiB limit for logo and photos without bypassing consent ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const maxUploadBytes = 3 * 1024 * 1024;
      const state = await privateMedia(page, [], maxUploadBytes);
      await visit(page, english);
      const section = page.locator('[data-og7="followup-media-consent"]');
      await expect(
        section.getByRole('listitem').filter({
          hasText: english
            ? 'Maximum 3 MB per file'
            : '3 Mo maximum par fichier'
        })
      ).toBeVisible();
      for (const hook of ['media-upload-logo-card', 'media-upload-photos-card'])
        await expect(section.locator(`[data-og7="${hook}"]`)).toContainText(
          english ? '3 MB' : '3 Mo'
        );

      const oversizedPng = Buffer.alloc(maxUploadBytes + 1);
      png.copy(oversizedPng);
      for (const kind of ['logo', 'photos']) {
        const filename = `oversized-${kind}.png`;
        const input = section.locator(`[data-og7="followup-upload-${kind}"]`);
        await expect(input).toBeEnabled();
        await input.setInputFiles({
          name: filename,
          mimeType: 'image/png',
          buffer: oversizedPng
        });
        const selection = section.locator(
          '[data-og7="media-upload-selection"]'
        );
        const confirmation = selection.locator(
          '[data-og7="media-usage-confirmation"]'
        );
        const send = selection.locator('[data-og7="media-upload-send"]');
        await expect(selection).toContainText(filename);
        await expect(confirmation).not.toBeChecked();
        await expect(send).toBeDisabled();
        expect(state.uploads).toEqual([]);
        await confirmation.check();
        await expect(confirmation).toBeChecked();
        await expect(send).toBeEnabled();
        await send.click();
        const attempt = section
          .locator('[data-og7="media-upload-attempt"]')
          .filter({ hasText: filename });
        await expect(attempt.getByRole('alert')).toContainText(
          english
            ? 'file exceeds the 3 MB limit.'
            : 'fichier dépasse la limite de 3 Mo.'
        );
        await expect(attempt.getByRole('img')).toHaveCount(0);
        await expect(selection).toHaveCount(0);
        await expect(input).toBeEnabled();
        expect(state.uploads).toEqual([]);
        expect(state.commands).toEqual([]);
        expect(state.assets).toEqual([]);
      }
      await expect(section.locator('[data-og7="media-gallery"]')).toHaveCount(
        0
      );
      await expect(
        section.locator('[data-og7="followup-photo-count"]')
      ).toContainText('0 / 3');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
    test(`image usage compact upload cards keep the empty gallery honest and adapt to available space ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page);
      await visit(page, english);
      const section = page.locator('[data-og7="followup-media-consent"]');
      const logo = section.locator('[data-og7="media-upload-logo-card"]');
      const photos = section.locator('[data-og7="media-upload-photos-card"]');
      const logoInput = logo.getByLabel(
        english ? 'Add logo' : 'Ajouter le logo',
        {
          exact: true
        }
      );
      const photoInput = photos.getByLabel(
        english ? 'Add photos' : 'Ajouter des photos',
        { exact: true }
      );
      await expect(logoInput).toBeEnabled();
      await expect(photoInput).toBeEnabled();
      await expect(logoInput).toHaveAttribute('accept', 'image/png');
      await expect(photoInput).toHaveAttribute('multiple', '');
      await expect(
        section.locator('[data-og7="media-gallery-empty"]')
      ).toBeVisible();
      await expect(section.locator('[data-og7="media-gallery"]')).toHaveCount(
        0
      );
      await expect(section.locator('[data-og7="followup-media"]')).toHaveCount(
        0
      );
      await expect(section.getByRole('img')).toHaveCount(0);
      await expect(
        section.locator('[data-og7="followup-photo-count"]')
      ).toContainText('0 / 3');

      const logoBox = (await logo.boundingBox())!;
      const photosBox = (await photos.boundingBox())!;
      if (english) {
        expect(Math.abs(logoBox.x - photosBox.x)).toBeLessThan(1);
        expect(photosBox.y).toBeGreaterThan(logoBox.y + logoBox.height);
      } else {
        expect(Math.abs(logoBox.y - photosBox.y)).toBeLessThan(1);
        expect(photosBox.x).toBeGreaterThan(logoBox.x + logoBox.width);
      }
      await section.screenshot({
        path: test.info().outputPath('media-empty.png')
      });
      await logoInput.focus();
      await expect(logoInput).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(photoInput).toBeFocused();
      const correction = section.locator('[data-og7="media-correction"]');
      const correctionInput = correction.getByRole('textbox');
      const sendCorrection = correction.getByRole('button', {
        name: english
          ? 'Send this correction request'
          : 'Transmettre cette demande de correction',
        exact: true
      });
      await correctionInput.fill('Too short');
      await expect(sendCorrection).toBeDisabled();
      await correctionInput.fill('Please crop this synthetic image.');
      await expect(sendCorrection).toBeEnabled();
      expect(state.commands).toEqual([]);
      expect(state.uploads).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="followup-media-consent"]')
            .analyze()
        ).violations
      ).toEqual([]);
    });
    test(`image usage compact gallery shows saved types and actual review states separately from the photo quota ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const logo: SponsorMediaAsset = {
        ...asset(),
        id: '10000000-0000-4000-8000-000000000410',
        kind: 'logo',
        reviewStatus: 'approved',
        originalFilename: 'synthetic-logo.png',
        altText: 'Synthetic organization logo'
      };
      const pendingPhoto = asset();
      const approvedPhoto: SponsorMediaAsset = {
        ...asset(),
        id: '10000000-0000-4000-8000-000000000411',
        reviewStatus: 'approved',
        originalFilename: 'approved-synthetic.png'
      };
      const rejectedPhoto: SponsorMediaAsset = {
        ...asset(),
        id: '10000000-0000-4000-8000-000000000412',
        reviewStatus: 'rejected',
        originalFilename: 'rejected-synthetic.png'
      };
      const state = await privateMedia(page, [
        logo,
        pendingPhoto,
        approvedPhoto,
        rejectedPhoto
      ]);
      await visit(page, english);
      const section = page.locator('[data-og7="followup-media-consent"]');
      const gallery = section.locator('[data-og7="media-gallery"]');
      const cards = gallery.locator('[data-og7="followup-media"]');
      await expect(cards).toHaveCount(4);
      await expect(gallery.getByRole('heading')).toContainText('4');
      await expect(
        section.locator('[data-og7="media-gallery-empty"]')
      ).toHaveCount(0);
      await expect(
        section.locator('[data-og7="followup-photo-count"]')
      ).toContainText('3 / 3');
      await expect(cards.nth(0)).toContainText('Logo');
      await expect(cards.nth(0)).toContainText(
        english ? 'Approved' : 'Approuvé'
      );
      await expect(cards.nth(1)).toContainText(
        english ? 'Presentation photo' : 'Photo de présentation'
      );
      await expect(cards.nth(1)).toContainText(
        english ? 'Under review' : 'En validation'
      );
      await expect(cards.nth(2)).toContainText(
        english ? 'Approved' : 'Approuvé'
      );
      await expect(cards.nth(3)).toContainText(
        english ? 'Needs replacement' : 'À remplacer'
      );
      await expect(
        section.getByLabel(english ? 'Replace logo' : 'Remplacer le logo', {
          exact: true
        })
      ).toBeDisabled();
      await expect(
        section.getByLabel(english ? 'Add photos' : 'Ajouter des photos', {
          exact: true
        })
      ).toBeDisabled();
      await expect(
        cards.nth(0).getByRole('img', { name: logo.altText! })
      ).toBeVisible();
      const tiles = await cards.evaluateAll((elements) =>
        elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        })
      );
      const columns = english ? 2 : 4;
      for (let index = 1; index < columns; index++) {
        expect(Math.abs(tiles[index].y - tiles[0].y)).toBeLessThan(1);
        expect(tiles[index].x).toBeGreaterThan(
          tiles[index - 1].x + tiles[index - 1].width
        );
      }
      if (english) {
        expect(Math.abs(tiles[2].x - tiles[0].x)).toBeLessThan(1);
        expect(tiles[2].y).toBeGreaterThan(tiles[0].y + tiles[0].height);
        expect(Math.abs(tiles[3].y - tiles[2].y)).toBeLessThan(1);
      }
      await section.screenshot({
        path: test.info().outputPath('media-gallery.png')
      });
      const details = cards.nth(1).locator('[data-og7="media-item-details"]');
      await expect(details).toHaveJSProperty('open', false);
      await details.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      await expect(details).toHaveJSProperty('open', true);
      await expect(
        details.locator('[data-og7="media-preference-propose"]')
      ).toBeEnabled();
      const gridBox = (await gallery
        .locator('[data-og7="media-gallery-grid"]')
        .boundingBox())!;
      const expandedBox = (await cards.nth(1).boundingBox())!;
      expect(Math.abs(expandedBox.x - gridBox.x)).toBeLessThan(1);
      expect(Math.abs(expandedBox.width - gridBox.width)).toBeLessThan(1);
      expect(
        await section.evaluate((element) => {
          const gallery = element.querySelector('[data-og7="media-gallery"]')!;
          const description = element.querySelector(
            '[data-og7="media-description"]'
          )!;
          const correction = element.querySelector(
            '[data-og7="media-correction"]'
          )!;
          return (
            !!(
              gallery.compareDocumentPosition(description) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ) &&
            !!(
              description.compareDocumentPosition(correction) &
              Node.DOCUMENT_POSITION_FOLLOWING
            )
          );
        })
      ).toBe(true);
      expect(state.commands).toEqual([]);
      expect(state.uploads).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="followup-media-consent"]')
            .analyze()
        ).violations
      ).toEqual([]);
    });
    test(`image usage shared consent link opens saved media actions without restoring the rights editor ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const second = {
        ...asset(),
        id: '10000000-0000-4000-8000-000000000403',
        originalFilename: 'second-synthetic.png',
        usage: unknown
      };
      const state = await privateMedia(page, [asset(), second]);
      const posts: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'POST')
          posts.push(new URL(request.url()).pathname);
      });
      let releaseMedia!: () => void;
      const mediaGate = new Promise<void>((resolve) => {
        releaseMedia = resolve;
      });
      await page.route(
        '**/api/sponsorship-followup/media?**',
        async (route) => {
          await mediaGate;
          return route.fallback();
        }
      );
      await page.goto(
        (english ? '/en' : '') +
          path +
          '?token=' +
          token +
          '&section=media-consent'
      );
      const section = page.locator('[data-og7="followup-media-consent"]');
      await expect(section).toHaveAttribute('aria-busy', 'true');
      await expect(section).not.toBeFocused();
      releaseMedia();
      await expect(section).toBeFocused();
      for (const actions of await section
        .locator('[data-og7="media-item-details"]')
        .all())
        await expect(actions).toHaveJSProperty('open', true);
      const disclosures = section.locator('[data-og7="followup-media-rights"]');
      await expect(disclosures).toHaveCount(0);
      await expect(
        section.locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      await expect(section).toContainText('synthetic.png');
      await expect(section).toContainText('second-synthetic.png');
      const url = new URL(page.url());
      expect(url.searchParams.has('token')).toBe(false);
      expect(url.searchParams.get('section')).toBe('media-consent');
      expect(posts).toEqual([]);
      expect(state.commands).toEqual([]);
      expect(state.uploads).toEqual([]);
      expect(state.assets[0]!.usage).toEqual(rights);
      expect(state.assets[1]!.usage).toEqual(unknown);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
    test(`image usage ignores unknown link sections and keeps saved media actions closed ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      const posts: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'POST') posts.push(request.url());
      });
      await page.goto(
        (english ? '/en' : '') +
          path +
          '?token=' +
          token +
          '&section=unknown-section'
      );
      const section = page.locator('[data-og7="followup-media-consent"]');
      await expect(section.locator('[data-og7="followup-media"]')).toHaveCount(
        1
      );
      await expect(section).toHaveAttribute('aria-busy', 'false');
      await expect(section).not.toBeFocused();
      await expect(
        section.locator('[data-og7="media-item-details"]')
      ).toHaveJSProperty('open', false);
      await expect(
        section.locator('[data-og7="followup-media-rights"]')
      ).toHaveCount(0);
      await expect(
        section.locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      expect(posts).toEqual([]);
      expect(state.commands).toEqual([]);
      expect(state.uploads).toEqual([]);
    });
    test(`image usage saved media details keep recorded rights unchanged without an editable permissions section ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      await visit(page, english);
      const media = page.locator(
        `[data-og7="followup-media"][data-og7-id="${id}"]`
      );
      const details = media.locator('[data-og7="media-item-details"]');
      const summary = details.locator(':scope > summary');
      await expect(details).toHaveJSProperty('open', false);
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(details).toHaveJSProperty('open', true);
      await expect(details).toContainText('synthetic.png');
      await expect(
        details.locator('[data-og7="followup-media-rights"]')
      ).toHaveCount(0);
      await expect(
        details.locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      await expect(
        details.locator('[data-og7="media-preference-propose"]')
      ).toBeEnabled();
      await expect(
        details.locator('[data-og7="media-usage-withdraw"]')
      ).toBeEnabled();
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(details).toHaveJSProperty('open', false);
      await summary.press('Enter');
      await expect(details).toHaveJSProperty('open', true);
      await expect(
        details.locator('[data-og7="media-usage-save"]')
      ).toHaveCount(0);
      expect(state.commands).toEqual([]);
      expect(state.uploads).toEqual([]);
      expect(state.assets[0].usage).toEqual(rights);
      expect(state.assets[0].reviewStatus).toBe('pending_review');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
    test(`image usage upload shows only explicit acceptance and aligned actions ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page);
      await visit(page, english);
      const input = page.getByLabel(
        english ? 'Add photos' : 'Ajouter des photos',
        { exact: true }
      );
      const description = page
        .locator('[data-og7="media-description"]')
        .getByRole('textbox');
      await description.fill('First synthetic accessible description');
      await expect(input).toBeEnabled();
      await input.setInputFiles({
        name: 'synthetic.png',
        mimeType: 'image/png',
        buffer: png
      });
      const selection = page.locator('[data-og7="media-upload-selection"]');
      await expect(selection).toContainText('synthetic.png');
      const editor = selection.locator('[data-og7="media-usage-editor"]');
      const confirmation = editor.getByRole('checkbox', {
        name: english
          ? /I accept the image usage terms/
          : /J’accepte les conditions d’utilisation des images/
      });
      const send = selection.locator('[data-og7="media-upload-send"]');
      await expect(editor.getByRole('checkbox')).toHaveCount(1);
      await expect(editor.locator('legend, details, p')).toHaveCount(0);
      await expect(confirmation).not.toBeChecked();
      await expect(send).toBeDisabled();
      expect(state.uploads).toHaveLength(0);
      await confirmation.focus();
      await confirmation.press('Space');
      await expect(send).toBeEnabled();
      await confirmation.press('Space');
      await expect(send).toBeDisabled();
      const [sendBox, cancelBox] = await selection.evaluate((element) =>
        ['media-upload-send', 'media-upload-cancel'].map((hook) => {
          const { x, y, width, height } = element
            .querySelector(`[data-og7="${hook}"]`)!
            .getBoundingClientRect();
          return { x, y, width, height };
        })
      );
      if (english) {
        expect(Math.abs(sendBox.x - cancelBox.x)).toBeLessThan(1);
        expect(Math.abs(sendBox.width - cancelBox.width)).toBeLessThan(1);
        expect(cancelBox.y).toBeGreaterThan(sendBox.y + sendBox.height);
      } else {
        expect(Math.abs(sendBox.y - cancelBox.y)).toBeLessThan(1);
        expect(Math.abs(sendBox.height - cancelBox.height)).toBeLessThan(1);
        expect(cancelBox.x).toBeGreaterThan(sendBox.x + sendBox.width);
      }
      expect(
        (await new AxeBuilder({ page }).include('.media-manager').analyze())
          .violations
      ).toEqual([]);
      await confirmAcceptanceMediaUsage(page);
      await expect(page.locator('[data-og7="followup-media"]')).toHaveCount(1);
      expect(state.uploads).toHaveLength(1);
      expect(state.uploads[0]).toMatch(
        /name="altText"\r\n\r\nFirst synthetic accessible description/
      );
      expect(state.uploads[0]).toContain(
        JSON.stringify({
          state: 'confirmed',
          channels: ['website'],
          targets: ['openg7'],
          transformations: ['technical'],
          credit: null,
          restrictions: null
        })
      );
      expect(state.uploads[0]).toMatch(/name="usageConfirmed"[\s\S]*?true/);
      const { version, fingerprint, locale } = getSponsorMediaUsageTerms(
        english ? 'en' : 'fr-CA'
      );
      expect(state.uploads[0]).toContain(
        JSON.stringify({ version, fingerprint, locale, accepted: true })
      );
      expect(state.uploads[0]).toMatch(/name="requestId"[\s\S]*?[a-f0-9-]{36}/);
      await expect(selection).toHaveCount(0);
      await description.fill('A different description for the next image');
      await input.setInputFiles({
        name: 'second.png',
        mimeType: 'image/png',
        buffer: png
      });
      await expect(
        selection.locator('[data-og7="media-usage-confirmation"]')
      ).not.toBeChecked();
      await expect(
        selection.locator('[data-og7="media-upload-send"]')
      ).toBeDisabled();
      await page.locator('[data-og7="media-upload-cancel"]').click();
      await expect(selection).toHaveCount(0);
      await expect(description).toHaveValue(
        'A different description for the next image'
      );
      expect(state.uploads).toHaveLength(1);
      expect(
        (await new AxeBuilder({ page }).include('.media-manager').analyze())
          .violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
    test(`image usage saved media never bypasses explicit consent for a new upload ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      await visit(page, english);
      await openAcceptanceMediaActions(page);
      const input = page.getByLabel(
        english ? 'Add photos' : 'Ajouter des photos',
        { exact: true }
      );
      await expect(input).toBeEnabled();
      await input.setInputFiles({
        name: 'new-synthetic.png',
        mimeType: 'image/png',
        buffer: png
      });
      const selection = page.locator('[data-og7="media-upload-selection"]');
      const editor = selection.locator('[data-og7="media-usage-editor"]');
      await expect(editor).toBeVisible();
      await expect(
        page.locator('[data-og7="followup-media-rights"]')
      ).toHaveCount(0);
      const confirmation = editor.locator(
        '[data-og7="media-usage-confirmation"]'
      );
      const send = selection.locator('[data-og7="media-upload-send"]');
      await expect(confirmation).not.toBeChecked();
      await expect(send).toBeDisabled();
      await confirmation.check();
      await expect(send).toBeEnabled();
      await selection.locator('[data-og7="media-upload-cancel"]').click();
      await expect(selection).toHaveCount(0);
      expect(state.commands).toEqual([]);
      expect(state.uploads).toEqual([]);
      expect(state.assets[0]!.usage).toEqual(rights);
      await input.setInputFiles({
        name: 'another-synthetic.png',
        mimeType: 'image/png',
        buffer: png
      });
      await expect(selection).toBeVisible();
      await expect(confirmation).not.toBeChecked();
      await expect(send).toBeDisabled();
    });
    test(`image usage upload checks uncertain receipts and retries the exact accepted file ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page);
      state.uploadFailure = true;
      state.receiptUnavailable = true;
      await visit(page, english);
      const input = page.getByLabel(
        english ? 'Add photos' : 'Ajouter des photos',
        { exact: true }
      );
      await expect(input).toBeEnabled();
      await input.setInputFiles({
        name: 'exact-file.png',
        mimeType: 'image/png',
        buffer: png
      });
      await confirmAcceptanceMediaUsage(page);
      const retry = page.locator('[data-og7="media-upload-retry"]');
      await expect(retry).toBeVisible();
      await expect(input).toBeDisabled();
      expect(state.uploads).toHaveLength(1);
      await retry.click();
      await expect.poll(() => state.receiptChecks).toBe(2);
      await expect(retry).toBeEnabled();
      expect(state.uploads).toHaveLength(1);
      state.uploadFailure = false;
      state.receiptUnavailable = false;
      await retry.click();
      await expect(page.locator('[data-og7="followup-media"]')).toHaveCount(1);
      await expect(retry).toHaveCount(0);
      expect(state.uploads).toHaveLength(2);
      const requestId = (body: string) =>
        body.match(/name="requestId"\r\n\r\n([^\r]+)/)?.[1];
      expect(requestId(state.uploads[0])).toMatch(/^[a-f0-9-]{36}$/);
      expect(requestId(state.uploads[1])).toBe(requestId(state.uploads[0]));
      for (const body of state.uploads)
        expect(body).toContain('filename="exact-file.png"');
    });
    test(`image usage withdrawal keeps a captured uncertain request and requires confirmation ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      await visit(page, english);
      const withdraw = page.locator('[data-og7="media-usage-withdraw"]');
      await openAcceptanceMediaActions(page);
      page.once('dialog', (dialog) => dialog.dismiss());
      await withdraw.click();
      expect(state.commands).toHaveLength(0);
      state.failure = true;
      page.once('dialog', (dialog) => dialog.accept());
      await withdraw.click();
      await expect(
        page.locator('[data-og7="media-usage-retry"]')
      ).toBeVisible();
      expect(state.commands).toHaveLength(1);
      const original = structuredClone(state.commands[0]);
      expect(original).toMatchObject({
        assetId: id,
        expectedVersion: 'v1',
        confirmed: true,
        usage: { ...rights, state: 'withdrawn' }
      });
      state.failure = false;
      await page.locator('[data-og7="media-usage-retry"]').click();
      await expect(page.locator('[data-og7="media-usage-retry"]')).toHaveCount(
        0
      );
      expect(state.commands[1]).toEqual(original);
      await expect(
        page.locator('[data-og7="media-preference-propose"]')
      ).toBeDisabled();
      expect(state.assets[0].reviewStatus).toBe('pending_review');
    });
    test(`image usage owned preference stays under review and a missing photo never substitutes another ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      await visit(page, english);
      await openAcceptanceMediaActions(page);
      await page.locator('[data-og7="media-preference-propose"]').click();
      await expect(page.locator('[data-og7="media-preference"]')).toContainText(
        english ? 'Request under review' : 'Demande en cours de revue'
      );
      expect(state.commands).toHaveLength(1);
      expect(state.commands[0]).toMatchObject({
        assetId: id,
        expectedRevision: 0,
        confirmed: true
      });
      expect(state.assets[0].reviewStatus).toBe('pending_review');
      state.assets = [];
      state.preference = { ...state.preference, available: false };
      await page.reload();
      await expect(page.locator('[data-og7="media-preference"]')).toContainText(
        english ? 'no other photo was selected' : 'aucune autre photo'
      );
      expect(state.preference.preferredAssetId).toBe(id);
      expect(state.commands).toHaveLength(1);
    });
    test(`image usage refused stale withdrawal refreshes the photo and accepts a new confirmed command ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      await visit(page, english);
      await openAcceptanceMediaActions(page);
      state.conflict = true;
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('[data-og7="media-usage-withdraw"]').click();
      await expect(page.locator('[data-og7="media-preference"]')).toContainText(
        english
          ? 'Review the refreshed information'
          : 'Vérifiez les informations actualisées'
      );
      await expect(page.locator('[data-og7="media-usage-retry"]')).toHaveCount(
        0
      );
      expect(state.commands).toHaveLength(1);
      expect(state.commands[0].expectedVersion).toBe('v1');
      await expect(
        page.locator('[data-og7="media-item-details"]')
      ).toHaveJSProperty('open', true);
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('[data-og7="media-usage-withdraw"]').click();
      await expect(
        page.locator('[data-og7="media-preference-propose"]')
      ).toBeDisabled();
      expect(state.commands).toHaveLength(2);
      expect(state.commands[1]).toMatchObject({
        expectedVersion: 'v2',
        confirmed: true,
        usage: { ...rights, state: 'withdrawn' }
      });
      expect(state.commands[1].requestId).not.toBe(state.commands[0].requestId);
    });
  }
}
async function openAdminRights(page: Page): Promise<void> {
  await page
    .locator('[data-og7="media-tile"]')
    .first()
    .getByRole('button')
    .click();
  const permissions = page
    .locator('[data-og7="media-inspector"] [data-og7="context-controller"]')
    .getByRole('button', {
      name: /^(Autorisations|Permissions)$/,
      exact: true
    });
  await permissions.focus();
  await permissions.press('Enter');
  await expect(
    page.locator('dialog[open] [data-og7="media-acceptance-review"]')
  ).toBeVisible();
}
interface AdminContext {
  fixtures(
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ): Promise<{ options: { media: SponsorMediaAsset[] } }>;
  path(tab?: string): string;
  asset(): SponsorMediaAsset;
}
async function adminMediaPage(
  page: Page,
  context: AdminContext,
  english: boolean
): Promise<void> {
  await page.setViewportSize(
    english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
  );
  await page.goto(context.path('media'));
  if (english)
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
}
export function registerAdminMediaUsageTests(context: AdminContext): void {
  const mediaFixture = createMediaWorkspaceFixture(context);
  for (const english of [false, true]) {
    const suffix = english ? 'EN mobile' : 'FR desktop';
    test(`image usage admin stale approval refreshes the file before a new explicit decision ${suffix}`, async ({
      page
    }) => {
      const { state, calls } = await mediaFixture(page);
      const selected = state.assets[0]!;
      await page.route(
        '**/api/admin/sponsorships/media/batch/plan',
        async (route) => {
          if (calls.plans.length) return route.fallback();
          calls.plans.push(route.request().postDataJSON());
          Object.assign(selected, { version: 'asset-v2' });
          Object.assign(state, { revision: 'workspace-v2' });
          return json(route, { code: 'VERSION_CONFLICT' }, 409);
        }
      );
      await adminMediaPage(page, context, english);
      await openAdminRights(page);
      await page.locator('[data-og7="media-acceptance-approve"]').click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toContainText(
        english
          ? 'The decision could not be prepared. Refresh the media before trying again.'
          : 'La décision n’a pas pu être préparée. Actualisez les médias avant de réessayer.'
      );
      expect(calls.executes).toEqual([]);
      await page.locator('[data-og7="media-acceptance-cancel"]').click();
      await page.locator('[data-og7="media-refresh"]').click();
      await expect(
        page.locator('[data-og7="media-review-workspace"]')
      ).toHaveAttribute('aria-busy', 'false');
      await openAdminRights(page);
      await page.locator('[data-og7="media-acceptance-approve"]').click();
      await expect(
        page.locator('[data-og7="media-batch-receipt"]')
      ).toBeVisible();
      expect(calls.plans).toHaveLength(2);
      expect(calls.plans.map((command) => command.expectedRevision)).toEqual([
        'workspace-v1',
        'workspace-v2'
      ]);
      expect(calls.plans.map((command) => command.assets[0]!.version)).toEqual([
        'asset-v1',
        'asset-v2'
      ]);
      expect(calls.executes).toHaveLength(1);
      expect(calls.rules).toEqual([]);
    });
    test(`image usage admin lost approval response freezes writes until the read-only receipt is verified ${suffix}`, async ({
      page
    }) => {
      const { calls } = await mediaFixture(page);
      const receipts: string[] = [];
      await page.route(
        '**/api/admin/sponsorships/media/batch/execute',
        async (route) => {
          calls.executes.push(route.request().postDataJSON());
          return route.abort('failed');
        }
      );
      await page.route(
        '**/api/admin/sponsorships/media/receipt?**',
        async (route) => {
          receipts.push(
            new URL(route.request().url()).searchParams.get('requestId')!
          );
          return json(route, {
            found: true,
            result: {
              requestId: calls.executes[0]!.requestId,
              planId: 'synthetic-plan',
              status: 'completed',
              action: 'approve',
              items: []
            }
          });
        }
      );
      await adminMediaPage(page, context, english);
      await openAdminRights(page);
      const approve = page.locator('[data-og7="media-acceptance-approve"]');
      await approve.click();
      await expect(page.locator('dialog[open] [role="alert"]')).toBeVisible();
      await expect(approve).toBeDisabled();
      await page.locator('[data-og7="media-acceptance-cancel"]').click();
      await expect(
        page.locator('[data-og7="media-inspector-approve"]')
      ).toBeDisabled();
      await page.locator('[data-og7="media-reconcile"]').click();
      await expect(
        page.locator('[data-og7="media-inspector-approve"]')
      ).toBeEnabled();
      expect(calls.plans).toHaveLength(1);
      expect(calls.executes).toHaveLength(1);
      expect(receipts).toEqual([calls.executes[0]!.requestId]);
      expect(calls.rules).toEqual([]);
    });
  }
  for (const english of [false, true])
    test(`image usage admin awaits sponsor consent without entering private evidence or granting rights ${english ? 'EN mobile' : 'FR desktop'}`, async ({
      page
    }) => {
      const { options } = await context.fixtures(page, 'operator');
      options.media = [{ ...context.asset(), usage: unknown }];
      const commands: Record<string, unknown>[] = [];
      await page.route(
        '**/api/admin/sponsorships/media/rules',
        async (route) => {
          commands.push(route.request().postDataJSON());
          return json(
            route,
            { code: 'UNEXPECTED_MANUAL_RIGHTS_MUTATION' },
            400
          );
        }
      );
      await adminMediaPage(page, context, english);
      await openAdminRights(page);
      const review = page.locator('[data-og7="media-acceptance-review"]');
      await expect(
        review.locator('[data-og7="media-acceptance-pending"]')
      ).toBeVisible();
      await expect(
        review.locator('[data-og7="media-acceptance-approve"]')
      ).toBeDisabled();
      await expect(
        review.locator('[data-og7="media-acceptance-reject"]')
      ).toBeEnabled();
      await expect(
        review.locator('[data-og7="media-acceptance-proof"]')
      ).toHaveCount(0);
      await expect(
        review.locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      await expect(
        review.locator('[data-og7="media-usage-evidence"]')
      ).toHaveCount(0);
      await expect(review.getByRole('combobox')).toHaveCount(0);
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      await review.locator('[data-og7="media-acceptance-cancel"]').click();
      expect(commands).toEqual([]);
      expect(options.media[0]!.usage).toEqual(unknown);
      expect(options.media[0]!.reviewStatus).toBe('pending_review');
    });
  test('image usage reader sees no private qualification or preference mutation control', async ({
    page
  }) => {
    const { options } = await context.fixtures(page, 'reader');
    options.media = [{ ...context.asset(), usage: unknown }];
    await page.route('**/api/admin/sponsorships/media**', (route) =>
      new URL(route.request().url()).pathname.endsWith('/media')
        ? json(route, {
            assets: options.media,
            preference: {
              revision: 7,
              preferredAssetId: options.media[0].id,
              correction: 'Please use this owned photograph.',
              state: 'pending',
              sponsorExplanation: null,
              available: true
            }
          })
        : route.fallback()
    );
    await page.goto(context.path('media'));
    await expect(page.locator('[data-og7="media-tile"]')).toBeVisible();
    await expect(page.locator('[data-og7="media-usage-evidence"]')).toHaveCount(
      0
    );
    await expect(
      page.locator('[data-og7="admin-media-preference-accept"]')
    ).toHaveCount(0);
  });
}
