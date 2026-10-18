import type { APIRequestContext, Page } from '@playwright/test';
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

/** Review the selected current media through the real gallery and atomic command. */
export async function approveAcceptanceMedia(
  page: Page,
  request: APIRequestContext,
  contributionId: string,
  ids: readonly string[],
  controller?: AdminController
): Promise<void> {
  const workspace = page.locator('[data-og7="media-review-workspace"]');
  await expect(workspace).toBeVisible();
  for (const id of ids) {
    const checkbox = workspace.locator(
      `[data-og7="media-tile"][data-og7-id="${id}"] input[type="checkbox"]`
    );
    await expect(checkbox).not.toBeChecked();
    if (controller) await controller.activate(checkbox);
    else await checkbox.check();
    await expect(checkbox).toBeChecked();
  }
  const planned = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/sponsorships/media/batch/plan') &&
      response.request().method() === 'POST'
  );
  const approve = page.locator('[data-og7="media-batch-approve"]');
  if (controller) await controller.activate(approve);
  else await approve.click();
  const response = await planned;
  expect(response.ok(), await response.text()).toBe(true);
  const input = response
    .request()
    .postDataJSON() as SponsorMediaBatchPlanRequest;
  expect(input).toMatchObject({ contributionId, action: 'approve' });
  expect(input.assets.map((asset) => asset.id).sort()).toEqual([...ids].sort());
  const plan = (await response.json()) as SponsorMediaBatchPlan;
  expect(plan).toMatchObject({
    contributionId,
    action: 'approve',
    blocked: []
  });
  expect(
    plan.assets
      .map((asset) => ({ id: asset.id, version: asset.version }))
      .sort((a, b) => a.id.localeCompare(b.id))
  ).toEqual(
    input.assets
      .map((asset) => ({ id: asset.id, version: asset.version }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
  const receipt = await confirmAcceptanceMediaManifest(
    page,
    'approve',
    ids,
    controller
  );
  expect(receipt.planId).toBe(plan.id);
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
  page: Page,
  request: APIRequestContext,
  contributionId: string,
  ids: readonly string[],
  controller?: AdminController
): Promise<void> {
  const current = new URL(page.url());
  if (
    current.searchParams.get('sponsorshipId') !== contributionId ||
    current.searchParams.get('tab') !== 'media'
  )
    await page.goto(
      '/admin/fundraiser/sponsors?sponsorshipId=' +
        contributionId +
        '&tab=media'
    );
  const before = await mediaWorkspace(request, contributionId);
  for (const id of ids) {
    expect(before.assets.find((asset) => asset.id === id)).toMatchObject({
      reviewStatus: 'approved',
      websiteSelected: false
    });
    const tile = page.locator(`[data-og7="media-tile"][data-og7-id="${id}"]`);
    const inspect = tile.getByRole('button');
    if (controller) await controller.activate(inspect);
    else await inspect.click();
    const inspector = page.locator('[data-og7="media-inspector"]');
    const advanced = inspector.getByText('Plus d’options', { exact: true });
    if (
      !(await advanced.evaluate((element) =>
        element.parentElement?.hasAttribute('open')
      ))
    ) {
      if (controller) await controller.activate(advanced);
      else await advanced.click();
    }
    const select = inspector.getByRole('button', {
      name: /^Choisir (?:comme photo du|pour le) site$/
    });
    if (controller) await controller.activate(select);
    else await select.click();
    await confirmAcceptanceMediaManifest(
      page,
      'website_select',
      [id],
      controller
    );
  }
  const after = await mediaWorkspace(request, contributionId);
  for (const id of ids)
    expect(after.assets.find((asset) => asset.id === id)).toMatchObject({
      websiteSelected: true
    });
}
