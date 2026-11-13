import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  SponsorMediaApproveAllCandidate,
  SponsorMediaApproveAllExecuteRequest,
  SponsorMediaApproveAllItemResult,
  SponsorMediaApproveAllPlan,
  SponsorMediaApproveAllPlanRequest,
  SponsorMediaApproveAllReceipt,
  SponsorMediaWorkspace
} from '@openg7/funding-core';

import { test, expect } from '../support/test.js';
import {
  adminController,
  installAdminController
} from '../support/admin-controller.js';

import {
  area,
  createMediaWorkspaceFixture,
  type MediaWorkspaceTestContext
} from './fixture.js';

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV0cAAAAASUVORK5CYII=',
  'base64'
);
const hook = (page: Page, name: string) =>
  page.locator(`[data-og7="media-approve-all-${name}"]`);

function mixedInventory(state: SponsorMediaWorkspace): void {
  const assets = state.assets.slice(0, 5);
  Object.assign(assets[1]!, {
    kind: 'logo',
    usage: {
      ...assets[1]!.usage,
      restrictions:
        'Synthetic restriction: retain the complete event caption, keep the original attribution and never crop the named artwork.'
    }
  });
  Object.assign(assets[2]!, {
    usage: { ...assets[2]!.usage, state: 'needs_confirmation' },
    readiness: {
      state: 'blocked',
      reasons: ['MEDIA_USAGE_CONFIRMATION_REQUIRED']
    }
  });
  Object.assign(assets[3]!, { reviewStatus: 'approved' });
  Object.assign(assets[4]!, {
    readiness: { state: 'blocked', reasons: ['MEDIA_INVALID'] }
  });
  Object.assign(state, { assets });
}

async function approveAllFixture(page: Page, state: SponsorMediaWorkspace) {
  const calls = {
    plans: [] as SponsorMediaApproveAllPlanRequest[],
    executes: [] as SponsorMediaApproveAllExecuteRequest[],
    receipts: [] as URL[],
    dropNextResponse: false,
    receiptFound: true,
    mode: 'completed' as
      'completed' | 'partial' | 'in_progress' | 'finalization',
    failId: ''
  };
  let plan: SponsorMediaApproveAllPlan | null = null;
  let receipt: SponsorMediaApproveAllReceipt | null = null;
  const approved = new Set<string>();
  const classify = (): SponsorMediaApproveAllCandidate[] =>
    state.assets.map((asset) => {
      if (asset.reviewStatus === 'approved')
        return {
          asset: structuredClone(asset),
          classification: 'already_approved',
          reasons: ['MEDIA_ALREADY_APPROVED']
        };
      if (asset.readiness.reasons.includes('MEDIA_INVALID'))
        return {
          asset: structuredClone(asset),
          classification: 'not_processable',
          reasons: ['MEDIA_INVALID']
        };
      if (asset.usage?.state !== 'confirmed')
        return {
          asset: structuredClone(asset),
          classification: 'blocked',
          reasons: [
            asset.usage?.state === 'withdrawn'
              ? 'MEDIA_USAGE_WITHDRAWN'
              : 'MEDIA_USAGE_CONFIRMATION_REQUIRED'
          ]
        };
      return {
        asset: structuredClone(asset),
        classification: 'eligible',
        reasons: []
      };
    });
  await page.route(
    '**/api/admin/sponsorships/media/approve-all/plan',
    async (route) => {
      calls.plans.push(route.request().postDataJSON());
      const candidates = classify();
      const count = (classification: string) =>
        candidates.filter((item) => item.classification === classification)
          .length;
      plan = {
        kind: 'approve_all',
        id: 'synthetic-approve-all-plan-' + calls.plans.length,
        contributionId: state.contributionId,
        revision: state.revision,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        candidates,
        summary: {
          total: candidates.length,
          eligible: count('eligible'),
          blocked: count('blocked'),
          alreadyApproved: count('already_approved'),
          notProcessable: count('not_processable'),
          authorizationRequired: candidates.filter(
            (item) => item.asset.usage?.state !== 'confirmed'
          ).length,
          consentRequestable: 1
        },
        effects: [
          'ACCEPT_MEDIA_ONLY',
          'NO_SOCIAL_PUBLICATION',
          'WEBSITE_SELECTION_UNCHANGED'
        ]
      };
      await route.fulfill({ json: plan });
    }
  );
  await page.route(
    '**/api/admin/sponsorships/media/approve-all/execute',
    async (route) => {
      const command = route
        .request()
        .postDataJSON() as SponsorMediaApproveAllExecuteRequest;
      calls.executes.push(command);
      const eligible = plan!.candidates.filter(
        (item) => item.classification === 'eligible'
      );
      const interrupted =
        calls.mode === 'in_progress' && calls.executes.length === 1;
      const finalizing =
        calls.mode === 'finalization' && calls.executes.length === 1;
      const items: SponsorMediaApproveAllItemResult[] = plan!.candidates.map(
        (candidate) => {
          const asset = candidate.asset;
          let result: SponsorMediaApproveAllItemResult['result'] =
            candidate.classification === 'eligible'
              ? 'approved'
              : candidate.classification;
          let reasons = candidate.reasons;
          if (candidate.classification === 'eligible') {
            if (interrupted && eligible[0]!.asset.id !== asset.id)
              result = 'pending';
            if (calls.mode === 'partial' && asset.id === calls.failId) {
              result = 'not_processable';
              reasons = ['MEDIA_PLAN_STALE'];
            }
            if (result === 'approved' && !approved.has(asset.id)) {
              approved.add(asset.id);
              Object.assign(
                state.assets.find((item) => item.id === asset.id)!,
                { reviewStatus: 'approved', version: 'approved-v2' }
              );
            }
          }
          return {
            id: asset.id,
            version: state.assets.find((item) => item.id === asset.id)!.version,
            originalFilename: asset.originalFilename,
            result,
            reasons
          };
        }
      );
      const count = (result: string) =>
        items.filter((item) => item.result === result).length;
      receipt = {
        kind: 'approve_all',
        requestId: command.requestId,
        planId: command.planId,
        contributionId: state.contributionId,
        status:
          interrupted || finalizing
            ? 'in_progress'
            : count('blocked') + count('not_processable') + count('failed') > 0
              ? 'partial'
              : 'completed',
        items,
        summary: {
          total: items.length,
          approved: count('approved'),
          alreadyApproved: count('already_approved'),
          blocked: count('blocked'),
          notProcessable: count('not_processable'),
          failed: count('failed'),
          pending: count('pending')
        }
      };
      Object.assign(state, { revision: 'workspace-after-approval' });
      if (calls.dropNextResponse) {
        calls.dropNextResponse = false;
        return route.abort('failed');
      }
      return route.fulfill({ json: receipt });
    }
  );
  await page.route(
    '**/api/admin/sponsorships/media/approve-all/receipt?*',
    async (route) => {
      calls.receipts.push(new URL(route.request().url()));
      return route.fulfill({
        json:
          calls.receiptFound && receipt
            ? { found: true, result: receipt }
            : { found: false }
      });
    }
  );
  return calls;
}

export function registerApproveAllMediaTests(
  context: MediaWorkspaceTestContext
): void {
  const fixture = createMediaWorkspaceFixture(context);
  for (const [language, width] of [
    ['fr-CA', 1440],
    ['en', 390]
  ] as const) {
    test(`approve all prepares the whole dossier with one confirmation and preserves excluded media ${language}`, async ({
      page
    }, info) => {
      const { state, calls: legacy } = await fixture(page);
      mixedInventory(state);
      const unchanged = structuredClone(state.assets.slice(2));
      const requests = await approveAllFixture(page, state);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(context.path('media'));
      const english = language === 'en';
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      await area(page)
        .locator('[data-og7="media-search"]')
        .fill(state.assets[2]!.originalFilename);
      await area(page)
        .locator('[data-og7="media-kind-filter"]')
        .selectOption('supporting_image');
      await area(page)
        .locator('[data-og7="media-tile"]')
        .first()
        .getByRole('checkbox')
        .check();
      await expect(area(page).locator('[data-og7="media-tile"]')).toHaveCount(
        1
      );
      const opener = hook(page, 'open');
      await expect(opener).toHaveText(
        english ? 'Approve all' : 'Tout approuver'
      );
      await expect(
        area(page).locator('[data-og7="media-count-total"]')
      ).toHaveText('5');
      await expect(
        area(page).locator('[data-og7="media-count-approved"]')
      ).toHaveText('1');
      await expect(
        area(page).locator('[data-og7="media-count-consent-action"]')
      ).toHaveAccessibleName(
        english ? /^Permission required/ : /^Autorisation requise/
      );
      await opener.focus();
      await opener.press('Enter');
      const panel = hook(page, 'panel');
      const confirm = hook(page, 'confirm');
      await expect(panel).toBeVisible();
      await expect(confirm).toBeEnabled();
      expect(requests.plans).toEqual([
        {
          requestId: expect.any(String),
          contributionId: state.contributionId,
          expectedRevision: 'workspace-v1'
        }
      ]);
      expect(requests.plans[0]).not.toHaveProperty('assets');
      expect(requests.plans[0]).not.toHaveProperty('filter');
      await expect(hook(page, 'candidates').locator('article')).toHaveCount(2);
      await expect(panel).toContainText(state.assets[1]!.usage!.restrictions!);
      await expect(panel.getByRole('textbox')).toHaveCount(0);
      await expect(panel.getByRole('checkbox')).toHaveCount(0);
      await expect(hook(page, 'summary')).toBeVisible();
      await expect(hook(page, 'summary')).toHaveText(
        english
          ? '5 media: 2 eligible, 1 already approved, 1 blocked, 1 not processable.'
          : '5 média(s) : 2 admissible(s), 1 déjà approuvé(s), 1 bloqué(s), 1 non traitable(s).'
      );
      await expect(panel).toContainText(
        english
          ? 'You are about to approve the 2 eligible media shown, including their descriptions and restrictions. Other media will remain unchanged. No publication will be triggered.'
          : 'Vous allez approuver les 2 média(s) admissibles présentés, avec leurs descriptions et restrictions. Les autres médias resteront inchangés. Aucune publication ne sera déclenchée.'
      );
      await page.locator('dialog[open]').screenshot({
        path: info.outputPath(`approve-all-confirm-${language}-${width}.png`)
      });
      const accessibility = await new AxeBuilder({ page })
        .include('dialog[open]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await hook(page, 'enlarge').first().click();
      await expect(hook(page, 'preview').locator('img')).toBeVisible();
      await expect(page.locator('dialog[open]')).toHaveCount(1);
      await panel
        .getByRole('button', {
          name: english ? 'Close enlarged preview' : 'Fermer l’aperçu agrandi',
          exact: true
        })
        .click();
      await expect(hook(page, 'enlarge').first()).toBeFocused();
      expect(requests.executes).toEqual([]);
      await hook(page, 'cancel').click();
      await expect(panel).not.toBeVisible();
      await expect(opener).toBeFocused();
      expect(requests.executes).toEqual([]);
      expect(state.assets.slice(2)).toEqual(unchanged);
      await opener.press('Enter');
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(hook(page, 'receipt')).toBeVisible();
      expect(requests.executes).toEqual([
        {
          requestId: expect.stringMatching(
            /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
          ),
          planId: 'synthetic-approve-all-plan-2',
          confirmation: 'synthetic-approve-all-plan-2',
          humanReviewed: true
        }
      ]);
      await expect(
        hook(page, 'results').locator('[data-state="approved"]')
      ).toHaveCount(2);
      await expect(
        hook(page, 'results').locator('[data-state="already_approved"]')
      ).toHaveCount(1);
      await expect(
        hook(page, 'results').locator('[data-state="blocked"]')
      ).toHaveCount(1);
      await expect(
        hook(page, 'results').locator('[data-state="not_processable"]')
      ).toHaveCount(1);
      expect(state.assets.slice(2)).toEqual(unchanged);
      expect(
        state.assets
          .slice(0, 2)
          .every((asset) => asset.reviewStatus === 'approved')
      ).toBe(true);
      expect(state.assets.every((asset) => !asset.websiteSelected)).toBe(true);
      expect(legacy.plans).toEqual([]);
      expect(legacy.executes).toEqual([]);
      expect(legacy.rules).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }

  test('approve all includes 101 files and a logo outside the visible page without individual review', async ({
    page
  }) => {
    const { state } = await fixture(page);
    const assets = [
      ...state.assets,
      {
        ...state.assets[0]!,
        id: 'synthetic-media-100',
        originalFilename: 'last-logo.webp',
        kind: 'logo' as const
      }
    ];
    for (const asset of assets)
      Object.assign(asset, {
        reviewStatus: 'pending_review',
        readiness: {
          state: 'needs_review',
          reasons: ['MEDIA_HUMAN_REVIEW_REQUIRED']
        }
      });
    Object.assign(state, { assets });
    const requests = await approveAllFixture(page, state);
    await page.goto(context.path('media'));
    await expect(area(page).locator('[data-og7="media-tile"]')).toHaveCount(8);
    await hook(page, 'open').click();
    await expect(hook(page, 'candidates').locator('article')).toHaveCount(101);
    await expect(hook(page, 'confirm')).toBeEnabled({ timeout: 20000 });
    expect(requests.executes).toEqual([]);
    await hook(page, 'confirm').click();
    await expect(
      hook(page, 'results').locator('[data-state="approved"]')
    ).toHaveCount(101);
    expect(requests.plans).toHaveLength(1);
    expect(requests.executes).toHaveLength(1);
  });

  test('approve all with zero eligible files has no approval confirmation', async ({
    page
  }) => {
    const { state } = await fixture(page);
    mixedInventory(state);
    for (const asset of state.assets.slice(0, 2))
      Object.assign(asset, { reviewStatus: 'approved' });
    const before = structuredClone(state.assets);
    const requests = await approveAllFixture(page, state);
    await page.goto(context.path('media'));
    await hook(page, 'open').click();
    await expect(hook(page, 'empty')).toBeVisible();
    await expect(hook(page, 'confirm')).toHaveCount(0);
    expect(requests.executes).toEqual([]);
    expect(state.assets).toEqual(before);
    await hook(page, 'cancel').click();
    await expect(hook(page, 'open')).toBeFocused();
  });

  test('approve all disables confirmation until every preview loads and offers one global preview retry', async ({
    page
  }) => {
    const { state } = await fixture(page);
    mixedInventory(state);
    const requests = await approveAllFixture(page, state);
    let failed = true;
    await page.route(
      '**/api/admin/sponsorships/media/content/**',
      async (route) => {
        const url = new URL(route.request().url());
        if (
          url.searchParams.get('variant') === 'thumbnail' &&
          url.pathname.endsWith(state.assets[1]!.id) &&
          failed
        )
          return route.fulfill({
            status: 503,
            json: { code: 'SYNTHETIC_PREVIEW_UNAVAILABLE' }
          });
        return route.fulfill({ contentType: 'image/png', body: pixel });
      }
    );
    await page.goto(context.path('media'));
    await hook(page, 'open').click();
    await expect(hook(page, 'preview-retry')).toBeVisible();
    await expect(hook(page, 'confirm')).toBeDisabled();
    expect(requests.executes).toEqual([]);
    failed = false;
    await hook(page, 'preview-retry').click();
    await expect(hook(page, 'confirm')).toBeEnabled();
    expect(requests.plans).toHaveLength(1);
    expect(requests.executes).toEqual([]);
    await hook(page, 'cancel').click();
  });

  test('approve all reports a partial result and keeps a changed eligible media unchanged', async ({
    page
  }) => {
    const { state } = await fixture(page);
    mixedInventory(state);
    const unchanged = structuredClone(state.assets[1]);
    const requests = await approveAllFixture(page, state);
    requests.mode = 'partial';
    requests.failId = state.assets[1]!.id;
    await page.goto(context.path('media'));
    await hook(page, 'open').click();
    await expect(hook(page, 'confirm')).toBeEnabled();
    await hook(page, 'confirm').click();
    await expect(
      hook(page, 'results').locator('[data-state="approved"]')
    ).toHaveCount(1);
    await expect(
      hook(page, 'results').locator(`[data-og7-id="${unchanged!.id}"]`)
    ).toContainText(
      'Le média ou ses autorisations ont changé depuis la préparation.'
    );
    expect(state.assets[1]).toEqual(unchanged);
    expect(requests.executes).toHaveLength(1);
  });

  test('approve all restores only an opaque UUID and checks an uncertain receipt without replaying approval', async ({
    page
  }) => {
    const { state } = await fixture(page);
    mixedInventory(state);
    const requests = await approveAllFixture(page, state);
    requests.dropNextResponse = true;
    await page.goto(context.path('media'));
    await hook(page, 'open').click();
    await expect(hook(page, 'confirm')).toBeEnabled();
    await hook(page, 'confirm').click();
    await expect(hook(page, 'error')).toBeVisible();
    expect(requests.executes).toHaveLength(1);
    const requestId = requests.executes[0]!.requestId;
    expect(
      await page.evaluate(
        (id) =>
          sessionStorage.getItem('openg7-media-approve-all-pending:' + id),
        state.contributionId
      )
    ).toBe(requestId);
    await page.reload();
    await expect(hook(page, 'unresolved')).toBeVisible();
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeDisabled();
    expect(requests.receipts).toEqual([]);
    expect(requests.executes).toHaveLength(1);
    await hook(page, 'open').click();
    requests.receiptFound = false;
    await hook(page, 'reconcile').click();
    await expect(hook(page, 'error')).toContainText('Aucun reçu');
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeDisabled();
    requests.receiptFound = true;
    await hook(page, 'reconcile').click();
    await expect(hook(page, 'receipt')).toBeVisible();
    await expect(
      hook(page, 'results').locator('[data-state="approved"]')
    ).toHaveCount(2);
    expect(
      requests.receipts.map((url) => url.searchParams.get('requestId'))
    ).toEqual([requestId, requestId]);
    expect(requests.executes).toHaveLength(1);
    expect(requests.plans).toHaveLength(1);
    expect(
      await page.evaluate(
        (id) =>
          sessionStorage.getItem('openg7-media-approve-all-pending:' + id),
        state.contributionId
      )
    ).toBeNull();
  });

  test('approve all resumes an acknowledged interrupted operation with the same UUID only after a new receipt check following loss', async ({
    page
  }) => {
    const { state } = await fixture(page);
    mixedInventory(state);
    const requests = await approveAllFixture(page, state);
    requests.mode = 'in_progress';
    await page.goto(context.path('media'));
    await hook(page, 'open').click();
    await expect(hook(page, 'confirm')).toBeEnabled();
    await hook(page, 'confirm').click();
    await expect(hook(page, 'resume')).toBeEnabled();
    await expect(
      hook(page, 'results').locator('[data-state="pending"]')
    ).toHaveCount(1);
    requests.dropNextResponse = true;
    await hook(page, 'resume').click();
    await expect(hook(page, 'error')).toBeVisible();
    await expect(hook(page, 'resume')).toBeDisabled();
    expect(requests.executes).toHaveLength(2);
    expect(requests.executes[1]).toEqual(requests.executes[0]);
    await hook(page, 'reconcile').click();
    await expect(
      hook(page, 'results').locator('[data-state="approved"]')
    ).toHaveCount(2);
    await expect(hook(page, 'resume')).toHaveCount(0);
    expect(requests.executes).toHaveLength(2);
  });

  test('approve all can resume finalization with no media remaining and no additional confirmation', async ({
    page
  }) => {
    const { state } = await fixture(page);
    mixedInventory(state);
    const requests = await approveAllFixture(page, state);
    requests.mode = 'finalization';
    await page.goto(context.path('media'));
    await hook(page, 'open').click();
    await expect(hook(page, 'confirm')).toBeEnabled();
    await hook(page, 'confirm').click();
    await expect(hook(page, 'receipt')).toContainText(
      'La finalisation de cette approbation reste à vérifier.'
    );
    await expect(hook(page, 'resume')).toHaveText('Reprendre la finalisation');
    await expect(hook(page, 'confirm')).toHaveCount(0);
    await hook(page, 'resume').click();
    await expect(hook(page, 'resume')).toHaveCount(0);
    expect(requests.executes).toHaveLength(2);
    expect(requests.executes[1]).toEqual(requests.executes[0]);
  });

  test('approve all is unavailable to a reader', async ({ page }) => {
    const { state } = await fixture(page, 'reader');
    mixedInventory(state);
    const requests = await approveAllFixture(page, state);
    await page.goto(context.path('media'));
    await expect(hook(page, 'open')).toBeDisabled();
    expect(requests.plans).toEqual([]);
    expect(requests.executes).toEqual([]);
  });

  test('approve all requires a fresh Xbox press after opening its confirmation', async ({
    page
  }) => {
    const { state } = await fixture(page);
    mixedInventory(state);
    const requests = await approveAllFixture(page, state);
    await installAdminController(page);
    await page.goto(context.path('media'));
    const pad = adminController(page);
    await expect(hook(page, 'open')).toBeEnabled();
    await hook(page, 'open').focus();
    await pad.hold('A');
    await expect(hook(page, 'panel')).toBeVisible();
    await expect(hook(page, 'confirm')).toBeEnabled();
    await pad.hold('A');
    await expect(hook(page, 'panel')).toBeVisible();
    expect(requests.executes).toEqual([]);
    await pad.release();
    await pad.activate(hook(page, 'confirm'));
    await expect(hook(page, 'receipt')).toBeVisible();
    expect(requests.executes).toHaveLength(1);
  });
}
