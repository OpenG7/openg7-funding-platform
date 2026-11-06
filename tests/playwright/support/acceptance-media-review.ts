import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';
import { MEDIA_REVIEW_MAX_SELECTION } from '@openg7/funding-core';
import type {
  ModerationContent,
  ModerationDecisionRecord,
  SponsorMediaBatchAction,
  SponsorMediaBatchExecuteRequest,
  SponsorMediaBatchPlan,
  SponsorMediaBatchPlanRequest,
  SponsorMediaBatchReceipt,
  SponsorMediaWorkspace,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { adminSessionHeaders } from './admin-auth.js';
import type { AdminController } from './admin-controller.js';
import { expect } from './test.js';

/** One explicit human confirmation for the exact server-built media manifest. */
export async function confirmAcceptanceMediaManifest(
  page: Page,
  action: SponsorMediaBatchAction,
  ids: readonly string[],
  controller?: AdminController
): Promise<SponsorMediaBatchReceipt> {
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  const manifest = page.locator('[data-og7="media-batch-manifest"]');
  await expect(manifest).toBeVisible();
  await expect(manifest.locator('openg7-media-review-thumbnail')).toHaveCount(
    ids.length
  );
  const confirmation = page.locator('[data-og7="media-manifest-confirmation"]');
  const execute = page.locator('[data-og7="media-batch-execute"]');
  await expect(confirmation).not.toBeChecked();
  await expect(execute).toBeDisabled();
  if (controller) await controller.activate(confirmation);
  else await confirmation.check();
  await expect(confirmation).toBeChecked();
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/sponsorships/media/batch/execute') &&
      response.request().method() === 'POST'
  );
  if (controller) await controller.activate(execute);
  else await execute.click();
  const response = await completed;
  expect(response.ok(), await response.text()).toBe(true);
  const input = response
    .request()
    .postDataJSON() as SponsorMediaBatchExecuteRequest;
  expect(input).toMatchObject({
    confirmation: input.planId,
    humanReviewed: true
  });
  const receipt = (await response.json()) as SponsorMediaBatchReceipt;
  expect(receipt).toMatchObject({
    requestId: input.requestId,
    action,
    status: 'completed',
    planId: input.planId
  });
  expect(receipt.items.map((item) => item.id).sort()).toEqual([...ids].sort());
  await expect(manifest).toHaveCount(0);
  return receipt;
}

/** Approval must retain a current N0 decision for each exact synthetic asset. */
export async function assertAcceptanceMediaApprovals(
  request: APIRequestContext,
  contributionId: string,
  ids: readonly string[]
): Promise<void> {
  const headers = await adminSessionHeaders(request);
  const mediaResponse = await request.get('/api/admin/sponsorships/media', {
    headers,
    params: { contributionId }
  });
  expect(mediaResponse.ok(), await mediaResponse.text()).toBe(true);
  const media = (await mediaResponse.json()) as SponsorshipMediaResponse;
  for (const id of ids) {
    expect(media.assets.find((asset) => asset.id === id)).toMatchObject({
      contributionId,
      reviewStatus: 'approved'
    });
    const params = { subjectType: 'media', subjectId: id };
    const contentResponse = await request.get('/api/admin/moderation/content', {
      headers,
      params
    });
    expect(contentResponse.ok(), await contentResponse.text()).toBe(true);
    const content = (await contentResponse.json()) as ModerationContent;
    expect(content.currentDecisionId).toBeTruthy();
    const decisionsResponse = await request.get(
      '/api/admin/moderation/decisions',
      { headers, params }
    );
    expect(decisionsResponse.ok(), await decisionsResponse.text()).toBe(true);
    const decisions = (await decisionsResponse.json()) as {
      items: ModerationDecisionRecord[];
    };
    expect(decisions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: content.currentDecisionId,
          level: 'N0',
          state: 'active',
          contentVersion: content.contentVersion,
          contentFingerprint: content.fingerprint
        })
      ])
    );
  }
}

/** Plan only explicitly reviewed synthetic fixture assets through the existing API. */
export async function prepareAcceptanceMediaPlan(
  request: APIRequestContext,
  contributionId: string,
  action: 'approve' | 'website_select' | 'delete',
  ids: readonly string[]
): Promise<SponsorMediaBatchPlan> {
  expect(
    process.env.OPENG7_E2E_ISOLATED,
    'Disposable fixture preparation only.'
  ).toBe('1');
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.length).toBeLessThanOrEqual(MEDIA_REVIEW_MAX_SELECTION);
  expect(new Set(ids).size).toBe(ids.length);
  const workspace = await mediaWorkspace(request, contributionId);
  expect(workspace.contributionId).toBe(contributionId);
  const assets = ids.map((id) => {
    const asset = workspace.assets.find((item) => item.id === id);
    expect(
      asset,
      'The requested synthetic asset must belong to this dossier.'
    ).toBeTruthy();
    expect(asset!.contributionId).toBe(contributionId);
    expect(asset!.version).toBeTruthy();
    return { id, version: asset!.version };
  });
  const input: SponsorMediaBatchPlanRequest = {
    requestId: randomUUID(),
    contributionId,
    expectedRevision: workspace.revision,
    action,
    assets
  };
  const response = await request.post(
    '/api/admin/sponsorships/media/batch/plan',
    { headers: await adminSessionHeaders(request), data: input }
  );
  expect(response.ok(), await response.text()).toBe(true);
  const plan = (await response.json()) as SponsorMediaBatchPlan;
  expect(plan).toMatchObject({
    contributionId,
    action,
    revision: workspace.revision,
    blocked: []
  });
  expect(
    plan.assets
      .map((asset) => ({ id: asset.id, version: asset.version }))
      .sort((a, b) => a.id.localeCompare(b.id))
  ).toEqual([...assets].sort((a, b) => a.id.localeCompare(b.id)));
  expect(Date.parse(plan.expiresAt)).toBeGreaterThan(Date.now());
  return plan;
}

/** This is API setup for known synthetic images, not a claim of gallery UI coverage. */
export async function executeAcceptanceMediaPlan(
  request: APIRequestContext,
  plan: SponsorMediaBatchPlan
): Promise<SponsorMediaBatchReceipt> {
  expect(
    process.env.OPENG7_E2E_ISOLATED,
    'Disposable fixture preparation only.'
  ).toBe('1');
  expect(plan.blocked).toEqual([]);
  const input: SponsorMediaBatchExecuteRequest = {
    requestId: randomUUID(),
    planId: plan.id,
    confirmation: plan.id,
    humanReviewed: true
  };
  let receipt: SponsorMediaBatchReceipt;
  try {
    const response = await request.post(
      '/api/admin/sponsorships/media/batch/execute',
      { headers: await adminSessionHeaders(request), data: input }
    );
    expect(response.ok(), await response.text()).toBe(true);
    receipt = (await response.json()) as SponsorMediaBatchReceipt;
  } catch (error) {
    // A lost acknowledgement can be inspected by its exact receipt, never by repeating a mutation.
    const response = await request.get(
      '/api/admin/sponsorships/media/receipt',
      {
        headers: await adminSessionHeaders(request),
        params: {
          contributionId: plan.contributionId,
          requestId: input.requestId
        }
      }
    );
    if (!response.ok()) throw error;
    const recorded = (await response.json()) as {
      found: boolean;
      result?: SponsorMediaBatchReceipt;
    };
    if (!recorded.found || !recorded.result) throw error;
    receipt = recorded.result;
  }
  expect(receipt).toMatchObject({
    requestId: input.requestId,
    planId: plan.id,
    action: plan.action,
    status: 'completed'
  });
  expect(receipt.items.map((item) => item.id).sort()).toEqual(
    plan.assets.map((asset) => asset.id).sort()
  );
  expect(
    receipt.items.every((item) => item.version && item.result === plan.action)
  ).toBe(true);
  return receipt;
}

/** Prepare reviewed synthetic media while the retired dossier gallery stays empty. */
export async function approveAcceptanceMedia(
  _page: Page,
  request: APIRequestContext,
  contributionId: string,
  ids: readonly string[],
  _controller?: AdminController
): Promise<void> {
  void _controller; // Retain existing fixture callers; this setup does not qualify controller UI.
  const plan = await prepareAcceptanceMediaPlan(
    request,
    contributionId,
    'approve',
    ids
  );
  await executeAcceptanceMediaPlan(request, plan);
  await assertAcceptanceMediaApprovals(request, contributionId, ids);
}

async function mediaWorkspace(
  request: APIRequestContext,
  contributionId: string
): Promise<SponsorMediaWorkspace> {
  const response = await request.get(
    '/api/admin/sponsorships/media/workspace',
    {
      headers: await adminSessionHeaders(request),
      params: { contributionId }
    }
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<SponsorMediaWorkspace>;
}

/** Website exposure remains a separately confirmed decision after media approval. */
export async function selectAcceptanceWebsiteMedia(
  _page: Page,
  request: APIRequestContext,
  contributionId: string,
  ids: readonly string[],
  _controller?: AdminController
): Promise<void> {
  void _controller; // The website-selection API remains separate from the removed gallery UI.
  const before = await mediaWorkspace(request, contributionId);
  for (const id of ids) {
    expect(before.assets.find((asset) => asset.id === id)).toMatchObject({
      reviewStatus: 'approved',
      websiteSelected: false
    });
    const plan = await prepareAcceptanceMediaPlan(
      request,
      contributionId,
      'website_select',
      [id]
    );
    await executeAcceptanceMediaPlan(request, plan);
  }
  const after = await mediaWorkspace(request, contributionId);
  for (const id of ids)
    expect(after.assets.find((asset) => asset.id === id)).toMatchObject({
      websiteSelected: true
    });
}
