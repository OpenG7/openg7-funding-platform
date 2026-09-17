import type {
  AdminSponsorshipsResponse,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN, SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { expect, test } from './support/test.js';

// Real API + PostgreSQL journeys. No route interception or shared mutation fixture.
test('a confirmed review removes its task, preserves queue filters and leaves publication independent', async ({
  page,
  request
}) => {
  const fixture = SPONSORSHIP_FIXTURES.acceptanceReview;
  const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
  const queueUrl =
    '/api/admin/attention?type=sponsorship_needs_review&pageSize=100';
  const beforeResponse = await request.get(queueUrl, { headers });
  expect(beforeResponse.ok()).toBe(true);
  const before = (await beforeResponse.json()) as AdminWorkQueueResponse;
  const task = before.items.find(
    (item) => item.facts['reference'] === fixture.publicReference
  );
  expect(task).toBeTruthy();
  await signInAsAdmin(page);
  const destination =
    '/admin/fundraiser/attention?type=sponsorship_needs_review';
  await page.goto(destination);
  await page.locator(`[data-og7-id="${task!.id}"]`).getByRole('link').click();
  await expect(page).toHaveURL(/sponsorshipId=/);
  await expect(
    page.locator('[data-og7="return-to-attention"]')
  ).toHaveAttribute('href', destination);
  await page.getByRole('button', { name: 'Accepter', exact: true }).click();
  await expect(
    page.getByText('Action confirmee: commandite acceptee.')
  ).toBeVisible();
  await page.locator('[data-og7="return-to-attention"]').click();
  await expect(page).toHaveURL(destination);
  await expect(page.locator(`[data-og7-id="${task!.id}"]`)).toHaveCount(0);
  const after = (await (
    await request.get(queueUrl, { headers })
  ).json()) as AdminWorkQueueResponse;
  expect(after.items.some((item) => item.id === task!.id)).toBe(false);
  const records = (await (
    await request.get(
      '/api/admin/sponsorships?search=' +
        encodeURIComponent(fixture.companyName),
      { headers }
    )
  ).json()) as AdminSponsorshipsResponse;
  expect(records.items).toHaveLength(1);
  expect(records.items[0]!.sponsor_review_status).toBe('approved');
  expect(records.items[0]!.sponsor_feed_status).toBe('not_planned');
  expect(
    records.items[0]!.admin_audit_entries.some(
      (entry) => entry.action === 'sponsorship_review.approved'
    )
  ).toBe(true);
});

test('global search opens a persisted invoice snapshot and its exact dossier', async ({
  page,
  request
}) => {
  const fixture = SPONSORSHIP_FIXTURES.acceptanceReview;
  await signInAsAdmin(page);
  // The seeded paid record is eligible; invoice creation follows the normal
  // explicit, scoped admin confirmation before testing the read-only search.
  const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
  const records = await (
    await request.get(
      '/api/admin/sponsorships?search=' +
        encodeURIComponent(fixture.companyName),
      { headers }
    )
  ).json();
  const id = records.items[0].id as string;
  await page.goto('/admin/fundraiser/invoices?contributionId=' + id);
  await page.getByRole('button', { name: /G[eé]n[eé]rer.*facture/i }).click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(
    page.getByRole('button', { name: new RegExp(fixture.companyName) })
  ).toBeVisible();
  await page.locator('[data-og7="admin-search-open"]').click();
  const search = page.getByRole('dialog');
  await search.getByRole('searchbox').fill(fixture.publicReference);
  const result = search.getByRole('button', {
    name: /Pr[eé]visualiser la facture/i
  });
  await expect(result).toHaveCount(1);
  await result.click();
  const inspector = page.getByRole('dialog');
  await expect(inspector).toContainText(fixture.companyName);
  await expect(inspector.getByRole('link', { name: /PDF/ })).toBeVisible();
  await inspector
    .getByRole('link', { name: 'Ouvrir la page complète' })
    .click();
  await expect(page).toHaveURL(new RegExp('contributionId=' + id));
});

test(
  'admin mobile navigation, language and search use real reads without business mutations',
  { tag: '@mobile' },
  async ({ page }) => {
    await signInAsAdmin(page);
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (
        request.url().includes('/api/admin/') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
      )
        mutations.push(request.url());
    });
    for (const route of [
      '',
      '/attention',
      '/sponsors',
      '/invoices',
      '/email-queue',
      '/audit'
    ]) {
      await page.goto('/admin/fundraiser' + route);
      await expect(page.locator('[data-og7="admin-layout"]')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        route
      ).toBe(true);
    }
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
    await page.goto('/admin/fundraiser');
    await expect(
      page.getByRole('heading', { name: 'Control centre' })
    ).toBeVisible();
    await page.locator('[data-og7="admin-search-open"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-og7="admin-search-open"]')).toBeFocused();
    expect(mutations).toEqual([]);
  }
);
