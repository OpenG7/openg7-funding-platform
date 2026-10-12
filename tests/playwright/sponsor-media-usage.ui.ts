import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  SponsorMediaAsset,
  SponsorMediaPreference,
  SponsorMediaUsageRights
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { json, mock, visit } from './support/sponsorship-followup.js';
import { confirmAcceptanceMediaUsage } from './support/acceptance-media-usage.js';

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
  initialAssets: readonly SponsorMediaAsset[] = []
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
    failure: false
  };
  await page.route('**/api/sponsorship-followup/media**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname.includes('/content/'))
      return route.fulfill({ contentType: 'image/png', body: png });
    if (req.method() === 'GET')
      return json(route, {
        assets: state.assets,
        preference: state.preference,
        limits: {
          maxUploadBytes: 1024,
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
      if (state.failure)
        return json(route, { code: 'MEDIA_USAGE_UNAVAILABLE' }, 503);
      if (url.pathname.endsWith('/usage')) {
        state.assets = state.assets.map((item) =>
          item.id === payload.assetId
            ? {
                ...item,
                usage: payload.usage,
                version: 'v2',
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
    test(`image usage upload requires explicit channels destination and portrait permission ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page);
      await visit(page, english);
      const input = page.getByLabel(
        english ? 'Add photos' : 'Ajouter des photos',
        { exact: true }
      );
      await expect(input).toBeDisabled();
      await confirmAcceptanceMediaUsage(page, {
        channels: ['website', 'facebook'],
        targets: ['openg7'],
        transformations: ['technical', 'portrait'],
        credit: rights.credit
      });
      await expect(input).toBeEnabled();
      await input.setInputFiles({
        name: 'synthetic.png',
        mimeType: 'image/png',
        buffer: png
      });
      await expect(page.locator('[data-og7="followup-media"]')).toHaveCount(1);
      expect(state.uploads).toHaveLength(1);
      expect(state.uploads[0]).toContain(JSON.stringify(rights));
      expect(state.uploads[0]).toMatch(/name="usageConfirmed"[\s\S]*?true/);
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
    test(`image usage withdrawal keeps a captured uncertain request and requires confirmation ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      await visit(page, english);
      const withdraw = page.locator('[data-og7="media-usage-withdraw"]');
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
  }
}
interface AdminContext {
  fixtures(
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ): Promise<{ options: { media: SponsorMediaAsset[] } }>;
  path(tab?: string): string;
  asset(): SponsorMediaAsset;
}
export function registerAdminMediaUsageTests(context: AdminContext): void {
  for (const english of [false, true])
    test(`image usage admin qualifies historical rights from private evidence without auto approval ${english ? 'EN mobile' : 'FR desktop'}`, async ({
      page
    }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      const { options } = await context.fixtures(page, 'operator');
      options.media = [{ ...context.asset(), usage: unknown }];
      const commands: Record<string, unknown>[] = [];
      await page.route(
        '**/api/admin/sponsorships/media/usage',
        async (route) => {
          const payload = route.request().postDataJSON();
          commands.push(payload);
          options.media = options.media.map((item) => ({
            ...item,
            version: 'v2',
            usage: payload.usage,
            usageRestrictionsReviewed: false
          }));
          return json(route, { updated: true, asset: options.media[0] });
        }
      );
      await page.goto(context.path('media'));
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const card = page.locator('[data-og7="admin-sponsor-media"]'),
        editor = card.locator('[data-og7="media-usage-editor"]');
      await expect(
        card.locator('[data-og7="admin-media-approve"]')
      ).toBeDisabled();
      await editor.locator('[data-og7-id="channel:website"]').check();
      await editor.locator('[data-og7-id="target:openg7"]').check();
      await editor.locator('[data-og7-id="transform:technical"]').check();
      await editor
        .locator('[data-og7="media-usage-evidence"]')
        .fill('Synthetic private permission record');
      await editor.locator('[data-og7="media-usage-confirmation"]').check();
      await editor.locator('[data-og7="media-usage-save"]').click();
      await expect(
        card.locator('[data-og7="admin-media-approve"]')
      ).toBeEnabled();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        assetId: options.media[0].id,
        expectedVersion: 'v1',
        confirmation: options.media[0].id,
        evidenceReference: 'Synthetic private permission record',
        usage: {
          state: 'confirmed',
          channels: ['website'],
          targets: ['openg7'],
          transformations: ['technical']
        }
      });
      expect(options.media[0].reviewStatus).toBe('pending_review');
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="admin-sponsor-media"]')
            .analyze()
        ).violations
      ).toEqual([]);
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
    await expect(
      page.locator('[data-og7="admin-sponsor-media"]')
    ).toBeVisible();
    await expect(page.locator('[data-og7="media-usage-evidence"]')).toHaveCount(
      0
    );
    await expect(
      page.locator('[data-og7="admin-media-preference-accept"]')
    ).toHaveCount(0);
  });
  for (const english of [false, true])
    test(`image usage admin preference decision confirms current revision and external explanation ${english ? 'EN mobile' : 'FR desktop'}`, async ({
      page
    }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      const { options } = await context.fixtures(page, 'operator');
      options.media = [context.asset()];
      let preference: SponsorMediaPreference = {
        revision: 7,
        preferredAssetId: options.media[0].id,
        correction: 'Please use this owned photograph.',
        state: 'pending',
        sponsorExplanation: null,
        available: true
      };
      const commands: Record<string, unknown>[] = [];
      await page.route('**/api/admin/sponsorships/media**', (route) => {
        const req = route.request(),
          url = new URL(req.url());
        if (url.pathname.endsWith('/media') && req.method() === 'GET')
          return json(route, { assets: options.media, preference });
        if (url.pathname.endsWith('/preference-review')) {
          const payload = req.postDataJSON();
          commands.push(payload);
          preference = {
            ...preference,
            revision: 8,
            state: payload.state,
            sponsorExplanation: payload.sponsorExplanation
          };
          return json(route, { updated: true, preference });
        }
        return route.fallback();
      });
      await page.goto(context.path('media'));
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const panel = page.locator('[data-og7="admin-media-preference"]'),
        accept = panel.locator('[data-og7="admin-media-preference-accept"]');
      await expect(accept).toBeDisabled();
      await panel
        .getByRole('textbox')
        .fill('The requested photo is suitable for preparation.');
      await panel
        .locator('[data-og7="admin-media-preference-confirmation"]')
        .check();
      await accept.click();
      await expect(panel).toContainText(
        english ? 'Preference accepted' : 'Préférence acceptée'
      );
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        contributionId: options.media[0].contributionId,
        confirmation: options.media[0].contributionId,
        expectedRevision: 7,
        state: 'accepted',
        sponsorExplanation: 'The requested photo is suitable for preparation.'
      });
      expect(commands[0].requestId).toMatch(/^[a-f0-9-]{36}$/i);
      expect(options.media[0].reviewStatus).toBe('pending_review');
    });
}
