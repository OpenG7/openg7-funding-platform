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
import { confirmAcceptanceMediaUsage } from './support/acceptance-media-usage.js';
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
    test(`image usage shared consent link opens the media list after loading without granting rights ${suffix}`, async ({
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
      const disclosures = section.locator('[data-og7="followup-media-rights"]');
      await expect(disclosures).toHaveCount(2);
      for (const disclosure of await disclosures.all()) {
        await expect(disclosure).toHaveJSProperty('open', true);
        await expect(
          disclosure.locator('[data-og7="media-usage-confirmation"]')
        ).not.toBeChecked();
        await expect(
          disclosure.locator('[data-og7="media-usage-save"]')
        ).toBeDisabled();
      }
      await expect(section).toContainText('synthetic.png');
      await expect(section).toContainText('second-synthetic.png');
      const url = new URL(page.url());
      expect(url.searchParams.has('token')).toBe(false);
      expect(url.searchParams.get('section')).toBe('media-consent');
      expect(posts).toEqual([]);
      expect(state.commands).toEqual([]);
      expect(state.uploads).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);

      // A subsequent explicit decision must not reopen other files or steal focus.
      await disclosures.nth(1).locator(':scope > summary').click();
      const editor = disclosures
        .first()
        .locator('[data-og7="media-usage-editor"]');
      await editor.locator('[data-og7="media-usage-confirmation"]').check();
      let releaseSave!: () => void;
      const saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      await page.route(
        '**/api/sponsorship-followup/media/usage',
        async (route) => {
          await saveGate;
          return route.fallback();
        }
      );
      await editor.locator('[data-og7="media-usage-save"]').click();
      await expect(section).toHaveAttribute('aria-busy', 'true');
      const otherControl = page.locator('[data-og7="followup-open-review"]');
      await otherControl.focus();
      releaseSave();
      await expect(section).toHaveAttribute('aria-busy', 'false');
      await expect(otherControl).toBeFocused();
      await expect(disclosures.nth(1)).toHaveJSProperty('open', false);
      expect(posts).toEqual(['/api/sponsorship-followup/media/usage']);
      expect(state.commands).toHaveLength(1);
      expect(state.commands[0]).toMatchObject({
        assetId: id,
        expectedVersion: 'v1',
        confirmed: true,
        termsAcceptance: { accepted: true, locale: english ? 'en' : 'fr-CA' }
      });
      expect(state.assets[1]!.usage).toEqual(unknown);
    });
    test(`image usage ignores unknown link sections and keeps consent unchecked ${suffix}`, async ({
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
      await expect(
        section.locator('[data-og7="followup-media-rights"]')
      ).toHaveCount(1);
      await expect(section).toHaveAttribute('aria-busy', 'false');
      await expect(section).not.toBeFocused();
      await expect(
        section.locator('[data-og7="followup-media-rights"]')
      ).toHaveJSProperty('open', false);
      await expect(
        section.locator('[data-og7="media-usage-confirmation"]')
      ).not.toBeChecked();
      expect(posts).toEqual([]);
      expect(state.commands).toEqual([]);
      expect(state.uploads).toEqual([]);
    });
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
      const summary = disclosure.locator(':scope > summary');
      await expect(disclosure).toHaveJSProperty('open', false);
      await expect(editor).toHaveCount(1);
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveJSProperty('open', true);
      await editor
        .locator('[data-og7="media-usage-customize"] > summary')
        .click();
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
      await expect(input).toBeEnabled();
      await input.setInputFiles({
        name: 'synthetic.png',
        mimeType: 'image/png',
        buffer: png
      });
      const selection = page.locator('[data-og7="media-upload-selection"]');
      await expect(selection).toContainText('synthetic.png');
      await expect(
        selection.locator('[data-og7="media-usage-confirmation"]')
      ).not.toBeChecked();
      await expect(
        selection.locator('[data-og7="media-upload-send"]')
      ).toBeDisabled();
      expect(state.uploads).toHaveLength(0);
      await confirmAcceptanceMediaUsage(page, {
        channels: ['website', 'facebook'],
        targets: ['openg7'],
        transformations: ['technical', 'portrait'],
        credit: rights.credit
      });
      await expect(page.locator('[data-og7="followup-media"]')).toHaveCount(1);
      expect(state.uploads).toHaveLength(1);
      expect(state.uploads[0]).toContain(JSON.stringify(rights));
      expect(state.uploads[0]).toMatch(/name="usageConfirmed"[\s\S]*?true/);
      const { version, fingerprint, locale } = getSponsorMediaUsageTerms(
        english ? 'en' : 'fr-CA'
      );
      expect(state.uploads[0]).toContain(
        JSON.stringify({ version, fingerprint, locale, accepted: true })
      );
      expect(state.uploads[0]).toMatch(/name="requestId"[\s\S]*?[a-f0-9-]{36}/);
      await expect(selection).toHaveCount(0);
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
    test(`image usage amendments capture explicit current terms without a manual evidence field ${suffix}`, async ({
      page
    }) => {
      await viewport(page);
      const state = await privateMedia(page, [asset()]);
      await visit(page, english);
      const disclosure = page.locator(
        `[data-og7="followup-media-rights"][data-og7-id="${id}"]`
      );
      await disclosure.locator(':scope > summary').click();
      const editor = disclosure.locator('[data-og7="media-usage-editor"]');
      await expect(
        editor.locator('[data-og7="media-usage-evidence"]')
      ).toHaveCount(0);
      await expect(
        editor.locator('[data-og7="media-usage-scope-summary"]')
      ).toContainText('OPENG7');
      await editor.locator('[data-og7="media-usage-terms"] > summary').click();
      const { version, fingerprint, locale, text } = getSponsorMediaUsageTerms(
        english ? 'en' : 'fr-CA'
      );
      await expect(
        editor.locator('[data-og7="media-usage-terms"]')
      ).toContainText(text);
      const confirmation = editor.locator(
        '[data-og7="media-usage-confirmation"]'
      );
      await editor
        .locator('[data-og7="media-usage-customize"] > summary')
        .click();
      await editor
        .locator('[data-og7="media-usage-credit"]')
        .fill('Unsaved synthetic credit');
      await confirmation.check();
      await editor.locator('[data-og7="media-usage-cancel"]').click();
      await expect(confirmation).not.toBeChecked();
      await expect(
        editor.locator('[data-og7="media-usage-credit"]')
      ).toHaveValue(rights.credit!);
      expect(state.commands).toEqual([]);
      await confirmation.check();
      await editor.locator('[data-og7="media-usage-save"]').click();
      await expect(confirmation).not.toBeChecked();
      expect(state.commands).toHaveLength(1);
      expect(state.commands[0]).toMatchObject({
        assetId: id,
        expectedVersion: 'v1',
        usage: rights,
        termsAcceptance: { version, fingerprint, locale, accepted: true }
      });
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
