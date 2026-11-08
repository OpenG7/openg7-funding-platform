import type { Page } from '@playwright/test';
import type {
  SponsorMediaBatchPlanRequest,
  SponsorMediaWorkspaceAsset,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { createMediaWorkspaceFixture } from '../media-review-workspace/fixture.js';

import {
  controllerId,
  controllerJourneysFixtures,
  controllerPath
} from './controller-journeys.fixtures.js';

export const galleryObligationIds = [
  '20000000-0000-4000-8000-000000000801',
  '20000000-0000-4000-8000-000000000802'
] as const;

/** Intercepted UI facts only. These references never reach a business database. */
export async function intelligentGalleryFixture(
  page: Page,
  options: {
    role?: 'reader' | 'operator';
    language?: 'fr-CA' | 'en';
    count?: number;
    missingIdentity?: boolean;
  } = {}
) {
  let base!: Awaited<ReturnType<typeof controllerJourneysFixtures>>;
  const fixture = createMediaWorkspaceFixture({
    fixtures: async (target, role) => {
      base = await controllerJourneysFixtures(
        target,
        role,
        options.language ?? 'fr-CA',
        { hardware: 'native' }
      );
      return base;
    },
    path: controllerPath,
    asset: () => base.media[0]!
  });
  const { state, calls } = await fixture(page, options.role ?? 'operator');
  const commitmentId = '20000000-0000-4000-8000-000000000800';
  const commitment: SponsorshipCommitmentRecord = {
    id: commitmentId,
    contributionId: controllerId,
    offerId: null,
    provenance: 'qualified_historical',
    state: 'active',
    qualificationReason: 'Synthetic captured terms',
    version: 1,
    offer: {
      version: 'synthetic-gallery-offer-v1',
      amountMinor: 50000,
      currency: 'CAD',
      benefits: [
        {
          id: 'website_mention',
          channel: 'website',
          target: 'openg7',
          quantity: 1,
          requiredElements: ['company_name', 'approved_presentation'],
          deadlineDays: null,
          durationDays: null
        },
        {
          id: 'facebook_batch',
          channel: 'facebook',
          target: 'openg7',
          quantity: 1,
          format: 'individual_portrait',
          requiredElements: ['company_name', 'approved_presentation'],
          deadlineDays: null,
          durationDays: null
        }
      ]
    },
    obligations: galleryObligationIds.map((id, index) => ({
      id,
      commitmentId,
      contributionId: controllerId,
      benefitId: index === 0 ? 'website_mention' : 'facebook_batch',
      channel: index === 0 ? 'website' : 'facebook',
      target: 'openg7',
      ordinal: 1,
      state: 'pending',
      blockedReason: null,
      version: 1,
      fulfilmentEvidenceId: null,
      format: index === 0 ? null : 'individual_portrait'
    }))
  };
  base.commitment = commitment;
  if (options.missingIdentity) {
    Object.assign(base.sponsor, {
      sponsor_contact_email: null,
      sponsor_details_submitted_at: null
    });
  }
  Object.assign(state, {
    assets: state.assets
      .slice(0, options.count ?? 20)
      .map((asset, index): SponsorMediaWorkspaceAsset => ({
        ...asset,
        sortOrder: index,
        kind: index === 0 ? 'logo' : 'supporting_image',
        usage: {
          ...asset.usage!,
          state: index === 19 ? 'withdrawn' : 'confirmed',
          channels: ['website', 'facebook'],
          transformations: ['technical', 'portrait']
        },
        readiness: {
          state:
            index === 19 ? 'blocked' : index === 18 ? 'needs_review' : 'ready',
          reasons:
            index === 19
              ? ['MEDIA_USAGE_WITHDRAWN']
              : index === 18
                ? ['MEDIA_HUMAN_REVIEW_REQUIRED']
                : []
        }
      })),
    preparationObligations: commitment.obligations.map((obligation) => ({
      id: obligation.id,
      version: obligation.version,
      channel: obligation.channel,
      target: obligation.target,
      ordinal: obligation.ordinal,
      format: obligation.format ?? null,
      state: obligation.state,
      acceptsMedia: true
    })),
    preparationAssignments: []
  });
  await page.route('**/api/admin/sponsorships/media/analyses*', (route) =>
    route.fulfill({
      json: {
        contributionId: controllerId,
        capabilities: {
          technical: 'local',
          vision: 'not_configured',
          ocr: 'not_configured'
        },
        runs: []
      }
    })
  );
  const commands: {
    uploads: string[];
    exports: Record<string, unknown>[];
    writes: string[];
    conflictNextPlan: boolean;
  } = { uploads: [], exports: [], writes: [], conflictNextPlan: false };
  let lastPlan: SponsorMediaBatchPlanRequest | null = null;
  await page.route(
    '**/api/admin/sponsorships/media/batch/plan',
    async (route) => {
      const request = route
        .request()
        .postDataJSON() as SponsorMediaBatchPlanRequest;
      calls.plans.push(request);
      commands.writes.push('plan:' + request.action);
      if (commands.conflictNextPlan) {
        commands.conflictNextPlan = false;
        return route.fulfill({
          status: 409,
          json: { error: 'MEDIA_VERSION_CONFLICT' }
        });
      }
      lastPlan = request;
      await route.fulfill({
        json: {
          id: 'synthetic-gallery-plan',
          contributionId: controllerId,
          action: request.action,
          revision: state.revision,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          preparationTarget: state.preparationObligations?.find(
            (item) => item.id === request.targetObligationId
          ),
          blocked: [],
          effects: ['PRIVATE_PREPARATION_ONLY'],
          assets: request.assets.map((item) =>
            state.assets.find((asset) => asset.id === item.id)!
          )
        }
      });
    }
  );
  await page.route(
    '**/api/admin/sponsorships/media/batch/execute',
    async (route) => {
      const request = route.request().postDataJSON();
      if (!request.humanReviewed || !lastPlan)
        return route.fulfill({ status: 400, json: {} });
      calls.executes.push(request);
      commands.writes.push('execute:' + lastPlan.action);
      const target = lastPlan.targetObligationId;
      let assignments = [...(state.preparationAssignments ?? [])];
      if (lastPlan.action === 'preparation_assign') {
        for (const asset of lastPlan.assets) {
          assignments = assignments.filter(
            (item) => item.obligationId !== target || item.assetId !== asset.id
          );
          assignments.push({
            id: 'synthetic-assignment-' + assignments.length,
            obligationId: target!,
            obligationVersion: lastPlan.targetObligationVersion!,
            assetId: asset.id,
            assetVersion: asset.version,
            actor: 'synthetic-operator',
            createdAt: '2026-11-05T12:00:00Z',
            stale: false
          });
        }
      } else if (lastPlan.action === 'preparation_unassign') {
        assignments = assignments.filter(
          (item) =>
            item.obligationId !== target ||
            !lastPlan!.assets.some((asset) => asset.id === item.assetId)
        );
      }
      Object.assign(state, {
        preparationAssignments: assignments,
        revision: 'workspace-after-' + calls.executes.length
      });
      await route.fulfill({
        json: {
          ...request,
          status: 'completed',
          action: lastPlan.action,
          items: lastPlan.assets.map((asset) => ({
            id: asset.id,
            version: asset.version,
            result: lastPlan!.action
          }))
        }
      });
    }
  );
  await page.route('**/api/admin/sponsorships/media/upload', async (route) => {
    const body = route.request().postDataBuffer()?.toString() ?? '';
    commands.uploads.push(body);
    await route.fulfill(
      body.includes('bad-file.png')
        ? { status: 400, json: { error: 'MEDIA_INVALID' } }
        : { json: { uploaded: true, asset: state.assets[1] } }
    );
  });
  await page.route('**/api/admin/sponsorships/media/export', async (route) => {
    commands.exports.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: 'image/webp',
      body: Buffer.from(
        'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
        'base64'
      )
    });
  });
  return { state, calls, base, commands };
}
