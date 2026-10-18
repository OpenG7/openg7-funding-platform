import type { Page } from '@playwright/test';
import type {
  SponsorMediaAsset,
  SponsorMediaWorkspace,
  SponsorMediaWorkspaceAsset,
  SponsorMediaBatchPlanRequest,
  SponsorMediaAnalysisRun,
  SponsorMediaAnalysisReviewRequest,
  SponsorMediaAnalysisResponse
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';

interface Context {
  fixtures(
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ): Promise<unknown>;
  path(tab?: string): string;
  asset(): SponsorMediaAsset;
}
const area = (page: Page) =>
  page.locator('[data-og7="media-review-workspace"]');
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV0cAAAAASUVORK5CYII=',
  'base64'
);
const analysisResponse = (
  contributionId: string,
  runs: readonly SponsorMediaAnalysisRun[]
): SponsorMediaAnalysisResponse => ({
  contributionId,
  capabilities: {
    technical: 'local',
    vision: 'not_configured',
    ocr: 'not_configured'
  },
  runs
});
const analysisRun = (
  assetId: string,
  changes: Partial<SponsorMediaAnalysisRun> = {}
): SponsorMediaAnalysisRun => ({
  id: 'synthetic-analysis',
  assetId,
  checksum: 'synthetic-checksum',
  adapterVersion: 'synthetic-local',
  state: 'succeeded',
  stale: false,
  errorCode: null,
  createdAt: '2026-10-18T12:00:00Z',
  finishedAt: '2026-10-18T12:00:01Z',
  suggestion: null,
  review: null,
  ...changes
});

/** Synthetic intercepted API with authoritative server manifests, never an external provider. */
export function registerMediaReviewWorkspaceTests(context: Context): void {
  async function fixture(page: Page, role: 'reader' | 'operator' = 'operator') {
    await context.fixtures(page, role);
    const sample = context.asset();
    const state: SponsorMediaWorkspace = {
      contributionId: sample.contributionId,
      revision: 'workspace-v1',
      writable: role !== 'reader',
      batches: [
        { id: 'synthetic-batch', name: 'Collecte automne', version: '1' }
      ],
      rules: [
        {
          id: 'synthetic-rules',
          scope: 'dossier',
          scopeId: sample.contributionId,
          revision: 1,
          coveredAssetIds: [],
          evidenceReference: 'Synthetic private permission register',
          usage: {
            state: 'confirmed',
            channels: ['website'],
            targets: ['openg7'],
            transformations: ['technical'],
            credit: 'Synthetic author',
            restrictions: null
          }
        }
      ],
      assets: Array.from(
        { length: 100 },
        (_, index): SponsorMediaWorkspaceAsset => ({
          ...sample,
          id: 'synthetic-media-' + index,
          originalFilename: `photo-${String(index + 1).padStart(3, '0')}.webp`,
          altText: `Vue synthétique ${index + 1}`,
          version: 'asset-v1',
          reviewStatus: 'pending_review',
          batchId: null,
          usageSource: 'dossier',
          ruleId: 'synthetic-rules',
          websiteSelected: false,
          usage: {
            state: 'confirmed',
            channels: ['website'],
            targets: ['openg7'],
            transformations: ['technical'],
            credit: 'Synthetic author',
            restrictions: null
          },
          readiness: {
            state:
              index < 97 ? 'ready' : index < 99 ? 'needs_review' : 'blocked',
            reasons:
              index < 97
                ? []
                : index < 99
                  ? ['MEDIA_HUMAN_REVIEW_REQUIRED']
                  : ['MEDIA_USAGE_WITHDRAWN']
          },
          moderation: {
            state: null,
            level: null,
            contentVersion: 1,
            fingerprint: 'synthetic-fingerprint-' + index,
            currentDecisionId: null
          }
        })
      )
    };
    const calls = {
      plans: [] as SponsorMediaBatchPlanRequest[],
      executes: [] as Record<string, unknown>[],
      thumbnails: [] as string[],
      rules: [] as Record<string, unknown>[],
      active: 0,
      maxActive: 0
    };
    let lastPlan: SponsorMediaBatchPlanRequest | null = null;
    await page.route('**/api/admin/sponsorships/media/workspace?**', (route) =>
      route.fulfill({ json: state })
    );
    await page.route(
      '**/api/admin/sponsorships/media/content/**',
      async (route) => {
        const thumbnail =
          new URL(route.request().url()).searchParams.get('variant') ===
          'thumbnail';
        if (thumbnail) {
          calls.thumbnails.push(route.request().url());
          calls.active++;
          calls.maxActive = Math.max(calls.maxActive, calls.active);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        await route.fulfill({ contentType: 'image/png', body: pixel });
        if (thumbnail) calls.active--;
      }
    );
    await page.route(
      '**/api/admin/sponsorships/media/batch/plan',
      async (route) => {
        const request = route
          .request()
          .postDataJSON() as SponsorMediaBatchPlanRequest;
        calls.plans.push(request);
        lastPlan = request;
        await route.fulfill({
          json: {
            id: 'synthetic-plan',
            contributionId: state.contributionId,
            action: request.action,
            revision: state.revision,
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            blocked: [],
            effects: [],
            assets: request.assets.map((item) => ({
              ...state.assets.find((asset) => asset.id === item.id),
              ...(item.altText === undefined ? {} : { altText: item.altText })
            }))
          }
        });
      }
    );
    await page.route(
      '**/api/admin/sponsorships/media/batch/execute',
      async (route) => {
        const request = route.request().postDataJSON();
        calls.executes.push(request);
        await route.fulfill({
          json: {
            requestId: request.requestId,
            planId: request.planId,
            action: lastPlan?.action,
            status: 'completed',
            items:
              lastPlan?.assets.map((asset) => ({
                id: asset.id,
                version: 'asset-v2',
                result: 'approved'
              })) ?? []
          }
        });
      }
    );
    await page.route('**/api/admin/sponsorships/media/rules', async (route) => {
      calls.rules.push(route.request().postDataJSON());
      await route.fulfill({ json: state });
    });
    return { state, calls };
  }

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
    await area(page).locator('[data-og7="media-dossier-rules"]').click();
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
    const { calls } = await fixture(page, 'reader');
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
  });

  test('media workspace future inheritance requires an explicit unchecked scope and private evidence', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    Object.assign(state, { assets: [] });
    await page.goto(context.path('media'));
    await area(page).locator('[data-og7="media-dossier-rules"]').click();
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

  test('media workspace analysis selection serializes requests and polls queued jobs to completion', async ({
    page
  }) => {
    await fixture(page);
    const jobs: import('@openg7/funding-core').SponsorMediaAnalysisRun[] = [];
    const commands: Record<string, unknown>[] = [];
    let reads = 0,
      active = 0,
      maxActive = 0;
    await page.route(
      '**/api/admin/sponsorships/media/analyses**',
      async (route) => {
        const request = route.request();
        if (request.method() === 'POST') {
          const command = request.postDataJSON();
          commands.push(command);
          active++;
          maxActive = Math.max(active, maxActive);
          jobs.push({
            id: 'analysis-' + commands.length,
            assetId: command.assetId,
            checksum: 'synthetic-checksum',
            adapterVersion: 'synthetic-local',
            state: 'queued',
            stale: false,
            errorCode: null,
            createdAt: new Date().toISOString(),
            finishedAt: null,
            suggestion: null,
            review: null
          });
        } else {
          reads++;
          if (jobs.length)
            for (const job of jobs) Object.assign(job, { state: 'succeeded' });
        }
        await route.fulfill({
          json: {
            contributionId: context.asset().contributionId,
            capabilities: {
              technical: 'local',
              vision: 'not_configured',
              ocr: 'not_configured'
            },
            runs: jobs
          }
        });
        if (request.method() === 'POST') active--;
      }
    );
    await page.goto(context.path('media'));
    const tiles = area(page).locator('[data-og7="media-tile"]');
    await tiles.nth(0).getByRole('checkbox').check();
    await tiles.nth(1).getByRole('checkbox').check();
    await area(page).locator('[data-og7="media-batch-analyze"]').click();
    await expect.poll(() => commands.length).toBe(2);
    expect(maxActive).toBe(1);
    expect(commands[0].requestId).not.toBe(commands[1].requestId);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await expect(tiles.first()).toContainText('Analyse disponible');
  });

  test('media workspace saved analysis draft survives late reads, closing and reload before acceptance', async ({
    page
  }) => {
    const { state } = await fixture(page),
      commands: SponsorMediaAnalysisReviewRequest[] = [];
    let run = analysisRun(state.assets[0].id),
      reads = 0,
      releaseStaleRead!: () => void;
    const staleRead = new Promise<void>((resolve) => {
      releaseStaleRead = resolve;
    });
    await page.route(
      '**/api/admin/sponsorships/media/analyses**',
      async (route) => {
        if (route.request().method() === 'POST') {
          const command = route
            .request()
            .postDataJSON() as SponsorMediaAnalysisReviewRequest;
          commands.push(command);
          run = {
            ...run,
            review: {
              version: (run.review?.version ?? 0) + 1,
              decision:
                command.decision === 'save'
                  ? 'saved'
                  : command.decision === 'accept'
                    ? 'accepted'
                    : 'rejected',
              draft: command.draft,
              actor: 'synthetic-operator',
              createdAt: '2026-10-18T12:01:00Z'
            }
          };
        } else {
          reads++;
          if (reads === 2) {
            const snapshot = JSON.stringify(
              analysisResponse(state.contributionId, [run])
            );
            await staleRead;
            await route.fulfill({
              contentType: 'application/json',
              body: snapshot
            });
            return;
          }
        }
        await route.fulfill({
          json: analysisResponse(state.contributionId, [run])
        });
      }
    );
    await page.goto(context.path('media'));
    const inspector = area(page).locator('[data-og7="media-inspector"]'),
      alt = inspector.locator('[data-og7="media-inspector-alt"]'),
      analysis = inspector.locator('[data-og7="media-analysis"]');
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    await analysis.locator('summary').click();
    await alt.fill('Human correction preserved across reload');
    await analysis
      .locator('[data-og7="media-analysis-classification"]')
      .selectOption('illustration');
    await area(page).locator('[data-og7="media-refresh"]').click();
    await expect.poll(() => reads).toBe(2);
    await analysis.locator('[data-og7="media-analysis-save"]').click();
    await expect.poll(() => reads).toBeGreaterThanOrEqual(3);
    await expect(analysis).toContainText('Brouillon enregistr\u00e9');
    const releasedResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/media/analyses') &&
        response.request().method() === 'GET'
    );
    releaseStaleRead();
    await releasedResponse;
    await expect(analysis).toContainText('Brouillon enregistr\u00e9');
    await inspector.locator('[data-og7="media-inspector-close"]').click();
    await expect(alt).toHaveCount(0);
    await page.reload();
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    await expect(alt).toHaveValue('Human correction preserved across reload');
    await analysis.locator('summary').click();
    await expect(
      analysis.locator('[data-og7="media-analysis-classification"]')
    ).toHaveValue('illustration');
    await analysis.locator('[data-og7="media-analysis-accept"]').click();
    await expect(analysis).toContainText(
      'Proposition de contenu accept\u00e9e'
    );
    expect(commands.map((command) => command.decision)).toEqual([
      'save',
      'accept'
    ]);
    expect(commands[1]).toMatchObject({
      expectedReviewVersion: 1,
      expectedVersion: state.assets[0].version,
      draft: {
        altText: 'Human correction preserved across reload',
        classification: 'illustration'
      }
    });
    await expect(
      analysis.locator('[data-og7="media-analysis-save"]')
    ).toHaveCount(0);
    await expect(
      analysis.locator('[data-og7="media-analysis-accept"]')
    ).toHaveCount(0);
    await expect(
      analysis.locator('[data-og7="media-analysis-reject"]')
    ).toHaveCount(0);
  });

  test('media workspace late saved analysis response preserves a newer local draft', async ({
    page
  }) => {
    const { state } = await fixture(page);
    let releaseRead!: () => void;
    const heldRead = new Promise<void>((resolve) => {
        releaseRead = resolve;
      }),
      run = analysisRun(state.assets[0].id, {
        review: {
          version: 1,
          decision: 'saved',
          draft: {
            altText: 'Earlier saved human description',
            classification: 'illustration'
          },
          actor: 'synthetic-operator',
          createdAt: '2026-10-18T12:01:00Z'
        }
      });
    await page.route(
      '**/api/admin/sponsorships/media/analyses**',
      async (route) => {
        await heldRead;
        await route.fulfill({
          json: analysisResponse(state.contributionId, [run])
        });
      }
    );
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    const inspector = area(page).locator('[data-og7="media-inspector"]'),
      alt = inspector.locator('[data-og7="media-inspector-alt"]');
    await alt.fill('Newer local unsaved description');
    await inspector.locator('[data-og7="media-analysis"] summary').click();
    releaseRead();
    await expect(
      inspector.locator('[data-og7="media-analysis"]')
    ).toContainText('Brouillon enregistr\u00e9');
    await expect(alt).toHaveValue('Newer local unsaved description');
    await expect(
      inspector.locator('[data-og7="media-analysis-classification"]')
    ).toHaveValue('unknown');
  });

  test('media workspace delayed initial analysis GET cannot erase a newly queued job or stop polling', async ({
    page
  }) => {
    const { state } = await fixture(page);
    let releaseInitialRead!: () => void,
      reads = 0,
      run: SponsorMediaAnalysisRun | null = null;
    const initialRead = new Promise<void>((resolve) => {
      releaseInitialRead = resolve;
    });
    await page.route(
      '**/api/admin/sponsorships/media/analyses**',
      async (route) => {
        if (route.request().method() === 'POST') {
          const command = route.request().postDataJSON();
          run = analysisRun(command.assetId, {
            state: 'queued',
            finishedAt: null
          });
        } else {
          reads++;
          if (reads === 1) {
            await initialRead;
            await route.fulfill({
              json: analysisResponse(state.contributionId, [])
            });
            return;
          }
          if (run)
            run = {
              ...run,
              state: 'succeeded',
              finishedAt: '2026-10-18T12:00:01Z'
            };
        }
        await route.fulfill({
          json: analysisResponse(state.contributionId, run ? [run] : [])
        });
      }
    );
    await page.goto(context.path('media'));
    const tile = area(page).locator('[data-og7="media-tile"]').first();
    await expect.poll(() => reads).toBe(1);
    await tile.getByRole('checkbox').check();
    await area(page).locator('[data-og7="media-batch-analyze"]').click();
    await expect(tile).toContainText('Analyse en attente');
    releaseInitialRead();
    await expect
      .poll(() => reads, { timeout: 10000 })
      .toBeGreaterThanOrEqual(2);
    await expect(tile).toContainText('Analyse disponible');
  });
}
