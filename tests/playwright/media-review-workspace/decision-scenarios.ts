import type { Page } from '@playwright/test';
import type {
  SponsorMediaRuleRequest,
  SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import { test, expect } from '../support/test.js';

import {
  area,
  createMediaWorkspaceFixture,
  type MediaWorkspaceTestContext
} from './fixture.js';

async function openDossierRules(page: Page): Promise<void> {
  const button = area(page).locator('[data-og7="media-dossier-rules"]');
  // The recommendations container and its nested rules panel are both details.
  // Scope the disclosure to the panel that directly owns the canonical command.
  const panel = button.locator('..');
  if ((await panel.getAttribute('open')) === null)
    await panel.locator(':scope > summary').click();
  await button.click();
}

function addPlatformAcceptance(
  asset: SponsorMediaWorkspaceAsset,
  locale: 'fr-CA' | 'en' = 'fr-CA'
): void {
  Object.assign(asset, {
    usageSource: 'media',
    ruleId: null,
    usageAcceptance: {
      id: 'synthetic-platform-acceptance',
      termsVersion: 'synthetic-media-terms-v1',
      termsFingerprint: 'f'.repeat(64),
      locale,
      acceptedAt: '2026-11-09T15:20:00.000Z',
      source: 'platform_acceptance'
    }
  });
}

export function registerMediaWorkspaceDecisionTests(
  context: MediaWorkspaceTestContext
): void {
  const fixture = createMediaWorkspaceFixture(context);
  for (const [language, width, entry] of [
    ['fr-CA', 1440, 'button'],
    ['en', 390, 'context']
  ] as const) {
    test(`platform media acceptance offers a simple explicit review and restores cancelled focus ${language}`, async ({
      page
    }, info) => {
      const { state, calls } = await fixture(page);
      const selected = state.assets[0]!;
      addPlatformAcceptance(selected, language);
      Object.assign(selected, { altText: null });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(context.path('media'));
      const english = language === 'en';
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const tiles = area(page).locator('[data-og7="media-tile"]');
      await tiles.nth(1).getByRole('checkbox').check();
      await tiles.first().getByRole('button').click();
      const inspector = area(page).locator('[data-og7="media-inspector"]');
      const opener =
        entry === 'context'
          ? inspector
              .locator('[data-og7="context-controller"]')
              .getByRole('button', {
                name: english ? 'Review and accept' : 'Examiner et accepter',
                exact: true
              })
          : inspector.locator('[data-og7="media-inspector-approve"]');
      await opener.focus();
      await opener.press('Enter');
      const dialog = page.locator('dialog[open]');
      const review = dialog.locator('[data-og7="media-acceptance-review"]');
      const approve = review.locator('[data-og7="media-acceptance-approve"]');
      const cancel = review.locator('[data-og7="media-acceptance-cancel"]');
      await expect(review).toBeVisible();
      await expect(review).toContainText(selected.originalFilename);
      await expect(
        review.locator('[data-og7="media-acceptance-proof"]')
      ).toBeVisible();
      await expect(
        review.locator('[data-og7="media-acceptance-proof"] time')
      ).toHaveAttribute('datetime', '2026-11-09T15:20:00.000Z');
      await expect(review).toContainText('synthetic-media-terms-v1');
      await expect(approve).toHaveText(
        english ? 'Approve and continue' : 'Approuver et continuer'
      );
      await expect(cancel).toHaveText(english ? 'Cancel' : 'Annuler');
      await expect(
        review.locator('[data-og7="media-usage-evidence"]')
      ).toHaveCount(0);
      await expect(
        review.locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      await expect(approve).toBeDisabled();
      expect(calls.rules).toEqual([]);
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      await cancel.focus();
      await cancel.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      await opener.press('Enter');
      await review
        .locator('[data-og7="media-acceptance-alt"]')
        .fill('Human description of the exact accepted image');
      await expect(approve).toBeEnabled();
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await dialog.screenshot({
        path: info.outputPath(`platform-media-review-${language}-${width}.png`)
      });
      await approve.click();
      await expect(
        area(page).locator('[data-og7="media-batch-receipt"]')
      ).toBeVisible();
      expect(calls.rules).toEqual([]);
      expect(calls.plans).toHaveLength(1);
      expect(calls.plans[0]).toMatchObject({
        contributionId: state.contributionId,
        expectedRevision: 'workspace-v1',
        action: 'approve',
        assets: [
          {
            id: selected.id,
            version: 'asset-v1',
            altText: 'Human description of the exact accepted image'
          }
        ]
      });
      expect(calls.plans[0]!.assets).toHaveLength(1);
      expect(calls.executes).toHaveLength(1);
      expect(calls.executes[0]).toMatchObject({
        planId: 'synthetic-plan',
        confirmation: 'synthetic-plan',
        humanReviewed: true
      });
      expect(calls.plans.map((plan) => plan.action)).toEqual(['approve']);
      expect(selected.websiteSelected).toBe(false);
      await expect(dialog).toHaveCount(0);
    });
  }

  test('platform media acceptance requires explicit review of recorded restrictions', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    const selected = state.assets[0]!;
    addPlatformAcceptance(selected);
    Object.assign(selected, {
      usage: {
        ...selected.usage,
        restrictions: 'Synthetic restriction: retain the event attribution'
      }
    });
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    await area(page).locator('[data-og7="media-inspector-approve"]').click();
    const review = page.locator('[data-og7="media-acceptance-review"]');
    const approve = review.locator('[data-og7="media-acceptance-approve"]');
    const restrictions = review.getByRole('checkbox');
    await expect(review).toContainText(
      'Synthetic restriction: retain the event attribution'
    );
    await expect(restrictions).not.toBeChecked();
    await expect(approve).toBeDisabled();
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
    await restrictions.check();
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(
      area(page).locator('[data-og7="media-batch-receipt"]')
    ).toBeVisible();
    expect(calls.plans[0]!.assets).toEqual([
      {
        id: selected.id,
        version: 'asset-v1',
        altText: selected.altText,
        usageRestrictionsConfirmed: true
      }
    ]);
    expect(calls.rules).toEqual([]);
    expect(calls.executes).toHaveLength(1);
  });

  for (const conflict of [
    'server-conflict',
    'changed-manifest',
    'changed-acceptance',
    'blocked-manifest'
  ] as const) {
    test(`platform media acceptance never executes after ${conflict}`, async ({
      page
    }) => {
      const { state, calls } = await fixture(page);
      const selected = state.assets[0]!;
      addPlatformAcceptance(selected);
      await page.route(
        '**/api/admin/sponsorships/media/batch/plan',
        async (route) => {
          if (conflict === 'server-conflict') {
            calls.plans.push(route.request().postDataJSON());
            await route.fulfill({
              status: 409,
              json: { error: 'MEDIA_WORKSPACE_CHANGED' }
            });
            return;
          }
          if (conflict === 'blocked-manifest') {
            const request = route.request().postDataJSON();
            calls.plans.push(request);
            await route.fulfill({
              json: {
                id: 'synthetic-blocked-plan',
                contributionId: state.contributionId,
                action: request.action,
                revision: state.revision,
                expiresAt: new Date(Date.now() + 600000).toISOString(),
                blocked: [{ id: selected.id, reasons: ['MEDIA_INVALID'] }],
                effects: [],
                assets: [{ ...selected, altText: request.assets[0].altText }]
              }
            });
            return;
          }
          if (conflict === 'changed-acceptance')
            Object.assign(selected, {
              usageAcceptance: {
                ...selected.usageAcceptance,
                id: 'synthetic-different-acceptance'
              }
            });
          else {
            Object.assign(selected, { version: 'asset-v2' });
            Object.assign(state, { revision: 'workspace-v2' });
          }
          await route.fallback();
        }
      );
      await page.goto(context.path('media'));
      await area(page)
        .locator('[data-og7="media-tile"]')
        .first()
        .getByRole('button')
        .click();
      await area(page).locator('[data-og7="media-inspector-approve"]').click();
      const review = page.locator('[data-og7="media-acceptance-review"]');
      await expect(review).toBeVisible();
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      await review.locator('[data-og7="media-acceptance-approve"]').click();
      await expect(page.locator('dialog[open] [role="alert"]')).toBeVisible();
      expect(calls.plans).toHaveLength(1);
      expect(calls.plans[0]).toMatchObject({
        expectedRevision: 'workspace-v1',
        assets: [{ id: selected.id, version: 'asset-v1' }]
      });
      expect(calls.executes).toEqual([]);
      expect(calls.rules).toEqual([]);
      await expect(
        area(page).locator('[data-og7="media-batch-receipt"]')
      ).toHaveCount(0);
    });
  }

  test('platform media acceptance reconciles a lost decision receipt without another approval', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    addPlatformAcceptance(state.assets[0]!);
    let receiptReads = 0;
    await page.route(
      '**/api/admin/sponsorships/media/batch/execute',
      async (route) => {
        calls.executes.push(route.request().postDataJSON());
        await route.abort('failed');
      }
    );
    await page.route('**/api/admin/sponsorships/media/receipt?**', (route) => {
      receiptReads++;
      return route.fulfill({
        json: {
          found: true,
          result: {
            requestId: calls.executes[0]?.requestId,
            planId: 'synthetic-plan',
            status: 'completed',
            action: 'approve',
            items: []
          }
        }
      });
    });
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    await area(page).locator('[data-og7="media-inspector-approve"]').click();
    const review = page.locator('[data-og7="media-acceptance-review"]');
    const approve = review.locator('[data-og7="media-acceptance-approve"]');
    await approve.click();
    await expect(page.locator('dialog[open] [role="alert"]')).toBeVisible();
    await expect(approve).toBeDisabled();
    expect(calls.plans).toHaveLength(1);
    expect(calls.executes).toHaveLength(1);
    await review.locator('[data-og7="media-acceptance-cancel"]').click();
    await expect(
      area(page).locator('[data-og7="media-inspector-approve"]')
    ).toBeDisabled();
    await area(page).locator('[data-og7="media-reconcile"]').click();
    await expect(
      area(page).locator('[data-og7="media-inspector-approve"]')
    ).toBeEnabled();
    expect(receiptReads).toBe(1);
    expect(calls.plans).toHaveLength(1);
    expect(calls.executes).toHaveLength(1);
    expect(calls.rules).toEqual([]);
  });

  for (const [language, width] of [
    ['fr-CA', 1440],
    ['en', 390]
  ] as const) {
    test(`media workspace pages 100 files with one inspector and bounded private thumbnails ${language}`, async ({
      page
    }, info) => {
      const { calls } = await fixture(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(context.path('media'));
      if (language === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      await area(page)
        .locator('[data-og7="media-page-size"]')
        .selectOption('25');
      await expect(area(page).locator('[data-og7="media-tile"]')).toHaveCount(
        25
      );
      await expect(
        area(page).locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      await expect(
        area(page).locator('[data-og7="media-inspector"]')
      ).toHaveCount(1);
      await area(page)
        .locator('[data-og7="media-tile"]')
        .first()
        .getByRole('button')
        .click();
      await expect(
        area(page).locator('[data-og7="media-full-preview"] img')
      ).toBeVisible();
      await expect(
        area(page).locator('[data-og7="media-inspector-alt"]')
      ).toHaveValue('Vue synthétique 1');
      expect(calls.maxActive).toBeLessThanOrEqual(4);
      expect(calls.thumbnails.length).toBeLessThanOrEqual(25);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await area(page).screenshot({
        path: info.outputPath(`media-workspace-${language}-${width}.png`)
      });
      await area(page).evaluate((element) =>
        element.scrollIntoView({ block: 'start', behavior: 'instant' })
      );
      await page.screenshot({
        path: info.outputPath(
          `media-workspace-viewport-${language}-${width}.png`
        )
      });
      await area(page).locator('[data-og7="media-next-page"]').click();
      await expect(
        area(page).locator('[data-og7="media-tile"]').first()
      ).toContainText('photo-026.webp');
      await area(page).locator('[data-og7="media-search"]').fill('photo-100');
      await expect(area(page).locator('[data-og7="media-tile"]')).toHaveCount(
        1
      );
      await area(page)
        .locator('[data-og7="media-tile"]')
        .getByRole('button')
        .click();
      await expect(
        area(page).locator('[data-og7="media-inspector-approve"]')
      ).toBeDisabled();
    });
  }

  for (const [language, width, entry] of [
    ['fr-CA', 1440, 'button'],
    ['en', 390, 'context']
  ] as const) {
    test(`guided media review asks for the inspected file permissions before acceptance ${language}`, async ({
      page
    }) => {
      const { state, calls } = await fixture(page);
      const selected = state.assets[0]!;
      Object.assign(selected, {
        altText: null,
        usage: {
          state: 'needs_confirmation',
          channels: [],
          targets: [],
          transformations: [],
          credit: null,
          restrictions: null
        },
        usageSource: 'media',
        ruleId: null,
        readiness: {
          state: 'blocked',
          reasons: ['MEDIA_USAGE_CONFIRMATION_REQUIRED']
        }
      });
      await page.route(
        '**/api/admin/sponsorships/media/rules',
        async (route) => {
          const request = route
            .request()
            .postDataJSON() as SponsorMediaRuleRequest;
          calls.rules.push({ ...request });
          Object.assign(selected, {
            usage: request.usage,
            ruleId: 'synthetic-guided-media-rule',
            version: 'asset-v2',
            readiness: {
              state: 'needs_review',
              reasons: [
                'MEDIA_ALT_TEXT_REQUIRED',
                'MEDIA_HUMAN_REVIEW_REQUIRED'
              ]
            }
          });
          Object.assign(state, { revision: 'workspace-v2' });
          await route.fulfill({ json: state });
        }
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(context.path('media'));
      const english = language === 'en';
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const tiles = area(page).locator('[data-og7="media-tile"]');
      await tiles.nth(1).getByRole('checkbox').check();
      await tiles.first().getByRole('button').click();
      const inspector = area(page).locator('[data-og7="media-inspector"]');
      const native = inspector.locator('[data-og7="media-inspector-approve"]');
      const contextual = inspector
        .locator('[data-og7="context-controller"]')
        .getByRole('button', {
          name: english ? 'Review and accept' : 'Examiner et accepter',
          exact: true
        });
      await expect(native).toBeEnabled();
      await expect(contextual).toBeEnabled();
      const opener = entry === 'context' ? contextual : native;
      await opener.focus();
      await opener.press('Enter');
      const dialog = page.locator('dialog[open]');
      const editor = dialog.locator('[data-og7="media-usage-editor"]');
      await expect(editor).toBeVisible();
      await expect(
        dialog.locator('[data-og7="media-review-permissions-help"]')
      ).toBeVisible();
      const scope = dialog.getByRole('combobox', {
        name: english ? 'Apply at level' : 'Appliquer au niveau',
        exact: true
      });
      await expect(scope).toHaveValue('media');
      await expect(scope).toBeDisabled();
      await expect(
        editor.locator('[data-og7="media-usage-confirmation"]')
      ).not.toBeChecked();
      await expect(
        editor.locator('[data-og7="media-usage-evidence"]')
      ).toBeVisible();
      await expect(
        editor.locator('[data-og7="media-usage-save"]')
      ).toBeDisabled();
      expect(calls.rules).toEqual([]);
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      await dialog
        .getByRole('button', {
          name: english ? 'Close' : 'Fermer',
          exact: true
        })
        .click();
      await expect(editor).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(calls.rules).toEqual([]);
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      await opener.click();
      await editor.locator('[data-og7-id="channel:website"]').check();
      await editor.locator('[data-og7-id="target:openg7"]').check();
      await editor.locator('[data-og7-id="transform:technical"]').check();
      await editor
        .locator('[data-og7="media-usage-evidence"]')
        .fill('Synthetic agreement for this exact image only');
      await expect(
        editor.locator('[data-og7="media-usage-save"]')
      ).toBeDisabled();
      await editor.locator('[data-og7="media-usage-confirmation"]').check();
      await editor.locator('[data-og7="media-usage-save"]').click();
      await expect.poll(() => calls.rules.length).toBe(1);
      expect(calls.rules[0]).toMatchObject({
        contributionId: state.contributionId,
        scope: 'media',
        scopeId: selected.id,
        confirmation: selected.id,
        coveredAssetIds: [selected.id],
        evidenceReference: 'Synthetic agreement for this exact image only',
        usage: {
          state: 'confirmed',
          channels: ['website'],
          targets: ['openg7'],
          transformations: ['technical']
        }
      });
      await expect(dialog).toHaveCount(0);
      const description = inspector.locator('[data-og7="media-inspector-alt"]');
      await expect(description).toBeFocused();
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      expect(selected.reviewStatus).toBe('pending_review');
      expect(selected.websiteSelected).toBe(false);
      await description.fill('Human description of the exact permitted image');
      await native.click();
      await expect(
        page.locator('[data-og7="media-batch-manifest"]')
      ).toBeVisible();
      expect(calls.plans).toHaveLength(1);
      expect(calls.plans[0]).toMatchObject({
        expectedRevision: 'workspace-v2',
        action: 'approve',
        assets: [
          {
            id: selected.id,
            version: 'asset-v2',
            altText: 'Human description of the exact permitted image'
          }
        ]
      });
      await expect(
        page.locator('[data-og7="media-batch-execute"]')
      ).toBeDisabled();
      expect(calls.executes).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }

  for (const reasons of [
    ['MEDIA_INVALID'],
    ['MEDIA_USAGE_WITHDRAWN'],
    ['MEDIA_REJECTED'],
    ['MODERATION_RESTRICTED'],
    ['MODERATION_RECONSIDERATION_OPEN'],
    ['MEDIA_USAGE_CONFIRMATION_REQUIRED', 'MEDIA_INVALID']
  ]) {
    test(`guided media review preserves the acceptance block for ${reasons.join(' and ')}`, async ({
      page
    }) => {
      const { state, calls } = await fixture(page);
      Object.assign(state.assets[0]!, {
        readiness: { state: 'blocked', reasons }
      });
      await page.goto(context.path('media'));
      await area(page)
        .locator('[data-og7="media-tile"]')
        .first()
        .getByRole('button')
        .click();
      const inspector = area(page).locator('[data-og7="media-inspector"]');
      await expect(
        inspector.locator('[data-og7="media-inspector-approve"]')
      ).toBeDisabled();
      await expect(
        inspector
          .locator('[data-og7="context-controller"]')
          .getByRole('button', { name: 'Examiner et accepter', exact: true })
      ).toBeDisabled();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      expect(calls.rules).toEqual([]);
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
    });
  }

  test('media workspace confirms one exact manifest for a multi-file human decision without publishing', async ({
    page
  }) => {
    const { calls } = await fixture(page);
    await page.goto(context.path('media'));
    const tiles = area(page).locator('[data-og7="media-tile"]');
    await tiles.nth(0).getByRole('checkbox').check();
    await tiles.nth(1).getByRole('checkbox').check();
    await tiles.nth(0).getByRole('button').click();
    await area(page)
      .locator('[data-og7="media-inspector-alt"]')
      .fill('Exact human alternative text');
    await area(page).locator('[data-og7="media-batch-approve"]').click();
    await expect(
      page.locator('[data-og7="media-batch-manifest"]')
    ).toContainText('Exact human alternative text');
    await expect(
      page.locator('[data-og7="media-batch-execute"]')
    ).toBeDisabled();
    expect(calls.executes).toHaveLength(0);
    await page.locator('[data-og7="media-manifest-confirmation"]').check();
    await page.locator('[data-og7="media-batch-execute"]').click();
    await expect(
      area(page).locator('[data-og7="media-batch-receipt"]')
    ).toBeVisible();
    expect(calls.plans).toHaveLength(1);
    expect(calls.executes).toHaveLength(1);
    expect(calls.plans[0].assets).toHaveLength(2);
    expect(calls.plans[0].assets[0].altText).toBe(
      'Exact human alternative text'
    );
    expect(calls.executes[0]).toMatchObject({
      planId: 'synthetic-plan',
      confirmation: 'synthetic-plan',
      humanReviewed: true
    });
  });

  test('media workspace rights evidence explicitly covers the selected files once at dossier scope', async ({
    page
  }, info) => {
    const { calls } = await fixture(page);
    await page.goto(context.path('media'));
    const tiles = area(page).locator('[data-og7="media-tile"]');
    await tiles.nth(0).getByRole('checkbox').check();
    await tiles.nth(1).getByRole('checkbox').check();
    await openDossierRules(page);
    const editor = page.locator('dialog[open] [data-og7="media-usage-editor"]');
    await expect(
      page.locator('[data-og7="media-rules-future"]')
    ).not.toBeChecked();
    await editor
      .locator('[data-og7="media-usage-evidence"]')
      .fill('Synthetic permission reference for these two files');
    await editor.locator('[data-og7="media-usage-confirmation"]').check();
    await page
      .locator('dialog[open]')
      .screenshot({ path: info.outputPath('media-shared-rules.png') });
    await editor.locator('[data-og7="media-usage-save"]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(calls.rules).toHaveLength(1);
    expect(calls.rules[0]).toMatchObject({
      scope: 'dossier',
      expectedRevision: 'workspace-v1',
      coveredAssetIds: ['synthetic-media-0', 'synthetic-media-1']
    });
  });

  test('media workspace lost receipt suspends writes and verifies read-only without replay', async ({
    page
  }) => {
    const { calls } = await fixture(page);
    await page.route(
      '**/api/admin/sponsorships/media/batch/execute',
      async (route) => {
        calls.executes.push(route.request().postDataJSON());
        await route.abort('failed');
      }
    );
    await page.route('**/api/admin/sponsorships/media/receipt?**', (route) =>
      route.fulfill({
        json: {
          found: true,
          result: {
            requestId: calls.executes[0]?.requestId,
            planId: 'synthetic-plan',
            status: 'completed',
            action: 'approve',
            items: []
          }
        }
      })
    );
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('checkbox')
      .check();
    await area(page).locator('[data-og7="media-batch-approve"]').click();
    await page.locator('[data-og7="media-manifest-confirmation"]').check();
    await page.locator('[data-og7="media-batch-execute"]').click();
    await expect(page.locator('dialog[open] [role="alert"]')).toBeVisible();
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: 'Fermer', exact: true })
      .click();
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeDisabled();
    await area(page).locator('[data-og7="media-reconcile"]').click();
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeEnabled();
    expect(calls.executes).toHaveLength(1);
  });

  test('media workspace reader can inspect with the keyboard while all writes and private history stay unavailable', async ({
    page
  }) => {
    const { state, calls } = await fixture(page, 'reader');
    addPlatformAcceptance(state.assets[0]!);
    await page.goto(context.path('media'));
    const tile = area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button');
    await tile.focus();
    await tile.press('Enter');
    await expect(
      area(page).locator('[data-og7="media-full-preview"] img')
    ).toBeVisible();
    await expect(
      area(page).locator('[data-og7="media-inspector-alt"]')
    ).toBeDisabled();
    await expect(
      area(page).locator('[data-og7="media-inspector-approve"]')
    ).toBeDisabled();
    await expect(area(page).locator('[data-og7="media-history"]')).toHaveCount(
      0
    );
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeDisabled();
    expect(calls.plans).toHaveLength(0);
    expect(calls.executes).toHaveLength(0);
    await expect(
      page.locator('[data-og7="media-acceptance-review"]')
    ).toHaveCount(0);
  });

  test('media workspace future inheritance requires an explicit unchecked scope and private evidence', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    Object.assign(state, { assets: [] });
    await page.goto(context.path('media'));
    await openDossierRules(page);
    const future = page.locator('[data-og7="media-rules-future"]');
    const editor = page.locator('dialog[open] [data-og7="media-usage-editor"]');
    await expect(future).not.toBeChecked();
    await expect(
      editor.locator('[data-og7="media-usage-save"]')
    ).toBeDisabled();
    await future.check();
    await editor
      .locator('[data-og7="media-usage-evidence"]')
      .fill('Synthetic agreement explicitly covering future photographs');
    await editor.locator('[data-og7="media-usage-confirmation"]').check();
    await editor.locator('[data-og7="media-usage-save"]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(calls.rules[0]).toMatchObject({
      includesFutureUploads: true,
      coveredAssetIds: [],
      scope: 'dossier'
    });
  });

  test('media workspace site selection manifest warns about immediate website visibility and keeps social authorization separate', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    Object.assign(state.assets[0], { reviewStatus: 'approved' });
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    const inspector = area(page).locator('[data-og7="media-inspector"]');
    await inspector.getByText('Plus d’options', { exact: true }).click();
    await inspector
      .getByRole('button', { name: 'Choisir pour le site', exact: true })
      .click();
    await expect(page.locator('dialog[open]')).toContainText(
      'Il peut devenir visible immédiatement'
    );
    await expect(page.locator('dialog[open]')).toContainText(
      'aucune publication sur les réseaux sociaux'
    );
    expect(calls.plans[0].action).toBe('website_select');
    expect(calls.executes).toHaveLength(0);
    await expect(
      page.locator('[data-og7="media-batch-execute"]')
    ).toBeDisabled();
  });
}
