import type {
  SponsorMediaAnalysisRun,
  SponsorMediaAnalysisReviewRequest,
  SponsorMediaAnalysisResponse
} from '@openg7/funding-core';

import { test, expect } from '../support/test.js';

import {
  area,
  createMediaWorkspaceFixture,
  type MediaWorkspaceTestContext
} from './fixture.js';

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

export function registerMediaWorkspaceAnalysisTests(
  context: MediaWorkspaceTestContext
): void {
  const fixture = createMediaWorkspaceFixture(context);
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
