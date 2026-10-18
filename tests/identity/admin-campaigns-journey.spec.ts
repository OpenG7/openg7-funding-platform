import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Response
} from '@playwright/test';
import type { AdminCampaignsResponse } from '@openg7/funding-core';

import { recordFixtureSponsorshipAgreement } from '../integration/support/sponsorship-agreement-fixture.mjs';

import { startIdentityStack } from './stack.mjs';
import { signInAdminIdentity } from './support/admin-browser.js';

const path = '/admin/fundraiser/campaigns';
const endpoint = '/api/admin/campaigns';
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

const listResponse = (
  page: Page,
  filters: Readonly<Record<string, string>> = {},
  status = 200
) =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === endpoint &&
      response.request().method() === 'GET' &&
      response.status() === status &&
      Object.entries(filters).every(
        ([key, value]) => url.searchParams.get(key) === value
      )
    );
  });

async function readList(response: Response): Promise<AdminCampaignsResponse> {
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  return response.json();
}

async function rowIds(page: Page): Promise<string[]> {
  return hook(page, 'campaign-row').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-og7-id')!)
  );
}

/** Built Angular, signed local OIDC, the real API entrypoint and disposable DB.
 * Every campaign response comes from the server; no browser route is intercepted.
 */
test('campaigns store reads the real authenticated API, retains its view across navigation and purges revoked sessions', async ({
  browser
}) => {
  const stack = await startIdentityStack();
  let context: BrowserContext | undefined;
  try {
    const sponsorId = randomUUID();
    const otherId = randomUUID();
    const reference = 'OG7-2026-CAMP0001';
    const company = 'Synthetic API multi-passage';
    const refreshedCompany = 'Synthetic API refreshed on return';

    // Existing confirmed payment facts are explicit fixture input. This test
    // qualifies browser-to-API/store behavior, not Stripe confirmation itself.
    await stack.pool.query(
      `INSERT INTO fund_contributions
       (id,contribution_type,amount_cents,currency,status,paid_at,public_reference,
        sponsor_company_name,sponsor_public_summary,sponsor_contact_email,
        sponsor_details_submitted_at,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
       VALUES($1,'sponsorship_interest',50000,'cad','paid','2026-01-01T12:00:00Z',$2,$3,
         'Synthetic presentation recorded for the API journey','contact@simulation.example.test',
         NOW(),TRUE,'pending_review',TRUE),
        ($4,'sponsorship_interest',50000,'cad','paid','2026-02-01T12:00:00Z','OG7-2026-CAMP0002',
         'Synthetic API LinkedIn dossier','Another explicitly agreed benefit',
         'other@simulation.example.test',NOW(),TRUE,'pending_review',TRUE)`,
      [sponsorId, reference, company, otherId]
    );
    await recordFixtureSponsorshipAgreement(stack.pool, sponsorId, {
      channel: 'facebook',
      quantity: 30
    });
    await recordFixtureSponsorshipAgreement(stack.pool, otherId, {
      channel: 'linkedin'
    });
    const obligations = (
      await stack.pool.query<{
        id: string;
        channel: string;
        contribution_id: string;
      }>(
        `SELECT id::text,channel,contribution_id::text FROM sponsorship_obligations
         WHERE contribution_id=ANY($1::uuid[]) ORDER BY id`,
        [[sponsorId, otherId]]
      )
    ).rows;
    const effectCounts = async () =>
      (
        await stack.pool.query(
          `SELECT (SELECT count(*)::int FROM publication_deliveries) AS deliveries,
            (SELECT count(*)::int FROM email_messages) AS emails`
        )
      ).rows[0];
    const before = await effectCounts();

    context = await browser.newContext({
      baseURL: stack.origin,
      viewport: { width: 1280, height: 1000 }
    });
    await context.addInitScript(() =>
      localStorage.setItem('openg7.language', 'fr-CA')
    );
    const page = await context.newPage();
    const errors: string[] = [];
    const writes: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        new URL(request.url()).pathname === endpoint &&
        request.method() !== 'GET'
      )
        writes.push(request.method());
    });

    await test.step('the page receives recorded obligations through the real authenticated campaign endpoint', async () => {
      const anonymous = await page.request.get(endpoint);
      expect(anonymous.status()).toBe(401);
      expect(anonymous.headers()['cache-control']).toContain('no-store');

      const loading = listResponse(page);
      await signInAdminIdentity(page, path);
      const response = await readList(await loading);
      await expect(page).toHaveURL(stack.origin + path);
      await expect(hook(page, 'campaigns-page')).toBeVisible();
      await expect(hook(page, 'campaign-row')).toHaveCount(25);
      expect(response.pagination.totalItems).toBe(31);
      expect(response.pagination.totalPages).toBe(2);
      const recorded = new Set(obligations.map((obligation) => obligation.id));
      expect(response.items.every((item) => recorded.has(item.id))).toBe(true);
      expect((await rowIds(page)).sort()).toEqual(
        response.items.map((item) => item.id).sort()
      );
      expect(response.items.every((item) => item.proof === null)).toBe(true);
    });

    const filters = {
      search: reference,
      channel: 'facebook',
      target: 'openg7',
      state: 'blocked',
      sort: 'paid_at',
      direction: 'asc'
    };
    let selectedId = '';
    await test.step('filters and pagination reach the server and select one exact promised passage', async () => {
      await hook(page, 'campaigns-search').fill(filters.search);
      await hook(page, 'campaigns-channel').selectOption(filters.channel);
      await hook(page, 'campaigns-target').selectOption(filters.target);
      await hook(page, 'campaigns-state').selectOption(filters.state);
      await hook(page, 'campaigns-sort').selectOption(filters.sort);
      await hook(page, 'campaigns-direction').selectOption(filters.direction);
      const applying = listResponse(page, { ...filters, page: '1' });
      await hook(page, 'campaigns-apply').click();
      const first = await readList(await applying);
      expect(first.pagination.totalItems).toBe(30);
      expect(first.items.every((item) => item.channel === 'facebook')).toBe(
        true
      );
      await expect(hook(page, 'campaign-row')).toHaveCount(25);

      const next = listResponse(page, { ...filters, page: '2' });
      await hook(page, 'campaigns-next').click();
      const second = await readList(await next);
      await expect(hook(page, 'campaign-row')).toHaveCount(5);
      expect(second.pagination.page).toBe(2);
      expect(
        [...first.items, ...second.items].map((item) => item.id).sort()
      ).toEqual(
        obligations
          .filter((obligation) => obligation.contribution_id === sponsorId)
          .map((obligation) => obligation.id)
          .sort()
      );
      selectedId = second.items[0]!.id;
      const selected = page.locator(
        `[data-og7="campaign-row"][data-og7-id="${selectedId}"]`
      );
      await selected.click();
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      await expect(hook(page, 'campaign-detail')).toContainText(company);
      await expect(hook(page, 'campaign-preparation')).toBeVisible();
    });

    await test.step('leaving and returning preserves store query, page and selection while rereading changed server facts', async () => {
      await page
        .locator(
          'openg7-admin-nav nav a[href="/admin/fundraiser/contributions"]'
        )
        .click();
      await expect(page).toHaveURL(
        stack.origin + '/admin/fundraiser/contributions'
      );
      await expect(hook(page, 'campaigns-page')).toHaveCount(0);

      await stack.pool.query(
        `UPDATE fund_contributions SET sponsor_company_name=$2,
           updated_at=clock_timestamp() WHERE id=$1`,
        [sponsorId, refreshedCompany]
      );
      const returning = listResponse(page, { ...filters, page: '2' });
      await page.locator(`openg7-admin-nav nav a[href="${path}"]`).click();
      const response = await readList(await returning);
      await expect(page).toHaveURL(stack.origin + path);
      expect(response.pagination.page).toBe(2);
      expect(
        response.items.every((item) => item.companyName === refreshedCompany)
      ).toBe(true);
      for (const [name, value] of Object.entries(filters))
        await expect(hook(page, 'campaigns-' + name)).toHaveValue(value);
      await expect(hook(page, 'campaign-row')).toHaveCount(5);
      await expect(hook(page, 'campaigns-previous')).toBeEnabled();
      await expect(hook(page, 'campaigns-next')).toBeDisabled();
      await expect(
        page.locator(`[data-og7="campaign-row"][data-og7-id="${selectedId}"]`)
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(hook(page, 'campaign-detail')).toContainText(
        refreshedCompany
      );
      await expect(hook(page, 'dossier-preparation')).toHaveAttribute(
        'aria-busy',
        'false'
      );
    });

    await test.step('a real revoked session receives 401 and erases rows and selected private details', async () => {
      const current = await page.request.get('/api/admin/auth/current');
      expect(current.status()).toBe(200);
      const { sessionId } = (await current.json()) as { sessionId: string };
      const revoked = await stack.pool.query(
        `UPDATE admin_identity_sessions SET revoked_at=NOW()
         WHERE id=$1::uuid AND revoked_at IS NULL RETURNING id`,
        [sessionId]
      );
      expect(revoked.rowCount).toBe(1);
      const denied = listResponse(page, { ...filters, page: '2' }, 401);
      await hook(page, 'campaigns-refresh').click();
      expect((await denied).headers()['cache-control']).toContain('no-store');
      await expect(page).toHaveURL(/\/admin\/login\?/);
      await expect(hook(page, 'campaign-row')).toHaveCount(0);
      await expect(hook(page, 'campaign-detail')).toHaveCount(0);
      await expect(
        page.getByText(refreshedCompany, { exact: true })
      ).toHaveCount(0);
      const login = new URL(page.url());
      expect(login.searchParams.get('returnUrl')).toBe(path);
      expect(login.searchParams.get('sessionExpired')).toBe('1');
      expect((await page.request.get(endpoint)).status()).toBe(401);

      const signingIn = listResponse(page, {
        page: '1',
        sort: 'preparation',
        direction: 'desc'
      });
      await signInAdminIdentity(page, path);
      const authorized = await signingIn;
      const fresh = await readList(authorized);
      expect(fresh.pagination.page).toBe(1);
      const params = new URL(authorized.url()).searchParams;
      expect(params.has('search')).toBe(false);
      expect(params.has('channel')).toBe(false);
      await expect(hook(page, 'campaigns-search')).toHaveValue('');
      await expect(hook(page, 'campaigns-channel')).toHaveValue('');
      await expect(hook(page, 'campaigns-state')).toHaveValue('');
      await expect(
        page.locator('[data-og7="campaign-row"][aria-pressed="true"]')
      ).toHaveCount(0);
      await expect(hook(page, 'campaign-preparation')).toHaveCount(0);
    });

    expect(await effectCounts()).toEqual(before);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await stack.stop();
  }
});
