import type { Locator, Page } from '@playwright/test';
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
    failure: false,
    conflict: false
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
    test(`image usage disclosure preserves edits without confirming rights ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      await visit(page, english);
      const disclosure = page.locator(
        `[data-og7="followup-media-rights"][data-og7-id="${id}"]`
      );
      const editor = disclosure.locator('[data-og7="media-usage-editor"]');
      const summary = disclosure.locator('summary');
      await expect(disclosure).toHaveJSProperty('open', false);
      await expect(editor).toHaveCount(1);
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveJSProperty('open', true);
      const credit = editor.locator('[data-og7="media-usage-credit"]');
      const confirmation = editor.locator(
        '[data-og7="media-usage-confirmation"]'
      );
      await expect(credit).toHaveValue(rights.credit!);
      await expect(confirmation).not.toBeChecked();
      await credit.fill('Synthetic retained media credit');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveJSProperty('open', false);
      await expect(credit).toHaveValue('Synthetic retained media credit');
      await summary.press('Enter');
      await expect(disclosure).toHaveJSProperty('open', true);
      await expect(confirmation).not.toBeChecked();
      await expect(
        editor.locator('[data-og7="media-usage-save"]')
      ).toBeDisabled();
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
    test(`image usage refused stale withdrawal refreshes the photo and accepts a new confirmed command ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      await visit(page, english);
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
function adminWorkspace(media: SponsorMediaAsset[]) {
  return {
    contributionId: media[0].contributionId,
    revision: 'workspace:' + media.map((asset) => asset.version).join(':'),
    writable: true,
    rules: [],
    batches: [],
    assets: media.map((asset) => ({
      ...asset,
      batchId: null,
      ruleId: null,
      usageSource: 'media',
      readiness: {
        state: asset.usage?.state === 'confirmed' ? 'ready' : 'blocked',
        reasons: []
      },
      moderation: {
        state: null,
        level: null,
        contentVersion: 1,
        fingerprint: asset.id,
        currentDecisionId: null
      },
      websiteSelected: false
    }))
  };
}
async function openAdminRights(page: Page): Promise<void> {
  await page
    .locator('[data-og7="media-tile"]')
    .first()
    .getByRole('button')
    .click();
  const inspector = page.locator('[data-og7="media-inspector"]');
  const summary = inspector.getByText(/^(Plus d’options|More options)$/);
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(summary.locator('..')).toHaveJSProperty('open', true);
  await inspector
    .getByRole('button', {
      name: /^(Personnaliser les autorisations|Customize permissions)$/
    })
    .click();
}
interface AdminContext {
  fixtures(
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ): Promise<{ options: { media: SponsorMediaAsset[] } }>;
  path(tab?: string): string;
  asset(): SponsorMediaAsset;
}
async function qualifyRights(editor: Locator): Promise<void> {
  await editor.locator('[data-og7-id="channel:website"]').check();
  await editor.locator('[data-og7-id="target:openg7"]').check();
  await editor.locator('[data-og7-id="transform:technical"]').check();
  await editor
    .locator('[data-og7="media-usage-evidence"]')
    .fill('Synthetic private permission record');
  await editor.locator('[data-og7="media-usage-confirmation"]').check();
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
  for (const english of [false, true]) {
    const suffix = english ? 'EN mobile' : 'FR desktop';
    test(`image usage admin stale qualification refreshes the version before a new confirmed command ${suffix}`, async ({
      page
    }) => {
      const { options } = await context.fixtures(page, 'operator');
      options.media = [{ ...context.asset(), usage: unknown }];
      const commands: Record<string, unknown>[] = [];
      await page.route(
        '**/api/admin/sponsorships/media/rules',
        async (route) => {
          const payload = route.request().postDataJSON();
          commands.push(payload);
          if (commands.length === 1) {
            options.media = options.media.map((item) => ({
              ...item,
              version: 'v2'
            }));
            return json(route, { code: 'VERSION_CONFLICT' }, 409);
          }
          options.media = options.media.map((item) => ({
            ...item,
            version: 'v3',
            usage: payload.usage
          }));
          return json(route, adminWorkspace(options.media));
        }
      );
      await adminMediaPage(page, context, english);
      await openAdminRights(page);
      const card = page.locator('[data-og7="media-inspector"]'),
        editor = page.locator('dialog[open] [data-og7="media-usage-editor"]');
      await qualifyRights(editor);
      await editor.locator('[data-og7="media-usage-save"]').click();
      await expect(page.locator('dialog[open]')).toContainText(
        english ? 'The dossier changed' : 'Le dossier a changé'
      );
      await expect(
        card.locator('[data-og7="admin-media-usage-retry"]')
      ).toHaveCount(0);
      await expect(
        editor.locator('[data-og7="media-usage-confirmation"]')
      ).not.toBeChecked();
      await qualifyRights(editor);
      await editor.locator('[data-og7="media-usage-save"]').click();
      await expect(
        card.locator('[data-og7="media-inspector-approve"]')
      ).toBeEnabled();
      expect(commands).toHaveLength(2);
      expect(commands.map((command) => command.expectedRevision)).toEqual([
        'workspace:v1',
        'workspace:v2'
      ]);
      expect(commands[1].requestId).not.toBe(commands[0].requestId);
      expect(options.media[0].reviewStatus).toBe('pending_review');
    });
    test(`image usage admin lost response freezes qualification until its read-only receipt is verified ${suffix}`, async ({
      page
    }) => {
      const { options } = await context.fixtures(page, 'operator');
      options.media = [{ ...context.asset(), usage: unknown }];
      const commands: Record<string, unknown>[] = [],
        receipts: string[] = [];
      await page.route(
        '**/api/admin/sponsorships/media/rules',
        async (route) => {
          const payload = route.request().postDataJSON();
          commands.push(payload);
          options.media = options.media.map((item) => ({
            ...item,
            version: 'v2',
            usage: payload.usage
          }));
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
            result: adminWorkspace(options.media)
          });
        }
      );
      await adminMediaPage(page, context, english);
      await openAdminRights(page);
      const editor = page.locator(
        'dialog[open] [data-og7="media-usage-editor"]'
      );
      await qualifyRights(editor);
      await editor.locator('[data-og7="media-usage-save"]').click();
      await expect(editor.getByRole('button')).toBeDisabled();
      await page
        .locator('dialog[open]')
        .getByRole('button', {
          name: english ? 'Close' : 'Fermer',
          exact: true
        })
        .click();
      await page.locator('[data-og7="media-reconcile"]').click();
      await expect(
        page.locator('[data-og7="media-inspector-approve"]')
      ).toBeEnabled();
      expect(commands).toHaveLength(1);
      expect(receipts).toEqual([commands[0].requestId]);
      expect(options.media[0].reviewStatus).toBe('pending_review');
    });
    for (const uncertain of [false, true])
      test(`image usage admin preference ${uncertain ? 'lost response replays the exact decision' : 'stale decision refreshes before a new confirmation'} ${suffix}`, async ({
        page
      }) => {
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
        await page.route('**/api/admin/sponsorships/media**', async (route) => {
          const req = route.request(),
            url = new URL(req.url());
          if (url.pathname.endsWith('/media') && req.method() === 'GET')
            return json(route, { assets: options.media, preference });
          if (!url.pathname.endsWith('/preference-review'))
            return route.fallback();
          const payload = req.postDataJSON();
          commands.push(payload);
          if (commands.length === 1) {
            preference = {
              ...preference,
              revision: 8,
              ...(uncertain
                ? {
                    state: 'accepted',
                    sponsorExplanation: payload.sponsorExplanation
                  }
                : {})
            };
            return uncertain
              ? route.abort('failed')
              : json(route, { code: 'VERSION_CONFLICT' }, 409);
          }
          if (!uncertain)
            preference = {
              ...preference,
              revision: 9,
              state: 'accepted',
              sponsorExplanation: payload.sponsorExplanation
            };
          return json(route, { updated: true, preference });
        });
        await adminMediaPage(page, context, english);
        const panel = page.locator('[data-og7="admin-media-preference"]'),
          confirmation = panel.locator(
            '[data-og7="admin-media-preference-confirmation"]'
          ),
          accept = panel.locator('[data-og7="admin-media-preference-accept"]');
        await panel
          .getByRole('textbox')
          .fill('The requested photo is suitable for preparation.');
        await confirmation.check();
        await accept.click();
        const retry = panel.locator(
          '[data-og7="admin-media-preference-retry"]'
        );
        if (uncertain) {
          await expect(retry).toBeVisible();
          await retry.click();
        } else {
          await expect(panel).toContainText(
            english
              ? 'Review the refreshed information'
              : 'Vérifiez les informations actualisées'
          );
          await expect(retry).toHaveCount(0);
          await expect(confirmation).not.toBeChecked();
          await confirmation.check();
          await accept.click();
        }
        await expect(panel).toContainText(
          english ? 'Preference accepted' : 'Préférence acceptée'
        );
        expect(commands).toHaveLength(2);
        if (uncertain) expect(commands[1]).toEqual(commands[0]);
        else {
          expect(commands.map((command) => command.expectedRevision)).toEqual([
            7, 8
          ]);
          expect(commands[1].requestId).not.toBe(commands[0].requestId);
        }
        expect(options.media[0].reviewStatus).toBe('pending_review');
      });
  }
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
        '**/api/admin/sponsorships/media/rules',
        async (route) => {
          const payload = route.request().postDataJSON();
          commands.push(payload);
          options.media = options.media.map((item) => ({
            ...item,
            version: 'v2',
            usage: payload.usage,
            usageRestrictionsReviewed: false
          }));
          return json(route, adminWorkspace(options.media));
        }
      );
      await page.goto(context.path('media'));
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      await openAdminRights(page);
      const card = page.locator('[data-og7="media-inspector"]'),
        editor = page.locator('dialog[open] [data-og7="media-usage-editor"]');
      await expect(
        card.locator('[data-og7="media-inspector-approve"]')
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
        card.locator('[data-og7="media-inspector-approve"]')
      ).toBeEnabled();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        scope: 'media',
        scopeId: options.media[0].id,
        expectedRevision: 'workspace:v1',
        confirmation: options.media[0].id,
        coveredAssetIds: [options.media[0].id],
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
            .include('[data-og7="media-inspector"]')
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
    await expect(page.locator('[data-og7="media-tile"]')).toBeVisible();
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
