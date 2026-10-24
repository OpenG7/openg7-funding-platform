import type { APIRequestContext, Page } from '@playwright/test';
import type {
  AdminAttentionItem,
  AdminPaymentJourney,
  AdminPaymentJourneyResponse,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { adminSessionHeaders } from './admin-auth.js';
import { expect } from './test.js';
import {
  adminController,
  installAdminController,
  type AdminController
} from './admin-controller.js';

const dashboard = '/admin/fundraiser';
const hook = (page: Page, name: string) =>
  page.locator(`[data-og7="payment-journey-${name}"]`);

/** Assert completion from a server response, without authentication, reads or UI actions. */
export function expectPaymentJourneyComplete(
  journey: AdminPaymentJourney
): void {
  expect(journey.state).toBe('complete');
  expect(journey.next).toBeNull();
  expect(journey.completed).toBe(journey.total);
  expect(journey.steps.length).toBeGreaterThan(0);
  expect(
    journey.steps.every((step) =>
      ['complete', 'not_required'].includes(step.state)
    )
  ).toBe(true);
}

/** Real private API reads; no application response or persisted fact is fabricated. */
export async function readPaymentJourney(
  request: APIRequestContext,
  contributionId: string
): Promise<AdminPaymentJourney> {
  const response = await request.get('/api/admin/payment-journey', {
    headers: await adminSessionHeaders(request),
    params: { contributionId }
  });
  expect(response.status()).toBe(200);
  const result = (await response.json()) as AdminPaymentJourneyResponse;
  expect(result.status).toBe('ok');
  expect(result.journey?.contributionId).toBe(contributionId);
  return result.journey!;
}

/** Read every page of required actions, keeping informational notices separate. */
export async function paymentAttentionItems(
  request: APIRequestContext,
  contributionId: string
): Promise<AdminAttentionItem[]> {
  const items: AdminAttentionItem[] = [];
  const headers = await adminSessionHeaders(request);
  for (let page = 1; page <= 100; page++) {
    const response = await request.get('/api/admin/attention', {
      headers,
      params: { page, pageSize: 100 }
    });
    expect(response.status()).toBe(200);
    const result = (await response.json()) as AdminWorkQueueResponse;
    expect(result.available).toBe(true);
    expect(result.coverage).toBe('complete');
    items.push(...result.items);
    if (page * result.pageSize >= result.filteredTotal) {
      return items.filter(
        (item) =>
          item.severity !== 'informational' &&
          (item.contributionId === contributionId ||
            item.sponsorshipId === contributionId)
      );
    }
  }
  throw new Error('The disposable attention queue exceeded its test bound.');
}

export async function openPaymentJourney(
  page: Page,
  contributionId: string,
  controller?: AdminController
) {
  await page.bringToFront();
  await page.goto(
    `${dashboard}/contributions?contributionId=${contributionId}`
  );
  if (controller) await controller.ready();
  await expect(page.locator('[data-og7="contribution-detail"]')).toBeVisible();
  await expect(
    page.locator('[data-og7="contributions-page"] [data-og7="payment-journey"]')
  ).toBeVisible();
  await expect(
    page.locator('[data-og7="admin-guidance"] [data-og7="payment-journey"]')
  ).toHaveCount(0);
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'ready');
}

/** Completion comes from the real server, remains true after a reload and survives a pause. */
export async function expectCompletedPaymentJourney(
  page: Page,
  request: APIRequestContext,
  contributionId: string,
  input: 'pointer' | 'controller' = 'pointer'
): Promise<AdminPaymentJourney> {
  await expect
    .poll(
      async () => (await readPaymentJourney(request, contributionId)).state,
      {
        timeout: 15000
      }
    )
    .toBe('complete');
  const journey = await readPaymentJourney(request, contributionId);
  expectPaymentJourneyComplete(journey);
  expect(await paymentAttentionItems(request, contributionId)).toEqual([]);
  if (input === 'controller') await installAdminController(page);
  const controller = input === 'controller' ? adminController(page) : null;
  await openPaymentJourney(page, contributionId, controller ?? undefined);
  await expect(hook(page, 'complete')).toBeVisible();
  await expect(hook(page, 'next')).toHaveCount(0);
  await page.reload();
  if (controller) await controller.ready();
  await expect(hook(page, 'complete')).toBeVisible();
  if (controller) {
    await controller.activate(hook(page, 'pause'));
    await controller.activate(
      page.locator(`openg7-admin-nav a[href="${dashboard}/attention"]`)
    );
    await expect(page).toHaveURL(new RegExp(`${dashboard}/attention$`));
  } else {
    await hook(page, 'pause').click();
    await page.goto(`${dashboard}/attention`);
  }
  await page.reload();
  await page.goto(
    `${dashboard}/contributions?contributionId=${contributionId}`
  );
  if (controller) await controller.ready();
  await expect(hook(page, 'paused')).toBeVisible();
  if (controller) await controller.activate(hook(page, 'resume'));
  else await hook(page, 'resume').click();
  await expect(hook(page, 'complete')).toBeVisible();
  await expect(hook(page, 'next')).toHaveCount(0);
  expect((await readPaymentJourney(request, contributionId)).state).toBe(
    'complete'
  );
  return journey;
}
