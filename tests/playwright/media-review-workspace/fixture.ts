import type { Page } from '@playwright/test';
import type {
  SponsorMediaAsset,
  SponsorMediaWorkspace,
  SponsorMediaWorkspaceAsset,
  SponsorMediaBatchPlanRequest
} from '@openg7/funding-core';

export interface MediaWorkspaceTestContext {
  fixtures(
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ): Promise<unknown>;
  path(tab?: string): string;
  asset(): SponsorMediaAsset;
}
export const area = (page: Page) =>
  page.locator('[data-og7="media-review-workspace"]');
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV0cAAAAASUVORK5CYII=',
  'base64'
);

/** Synthetic intercepted API with authoritative server manifests, never an external provider. */
export function createMediaWorkspaceFixture(
  context: MediaWorkspaceTestContext
) {
  return async function fixture(
    page: Page,
    role: 'reader' | 'operator' = 'operator'
  ) {
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
  };
}
