import type { AdminSponsorshipRecord } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const initialId = '10000000-0000-4000-8000-000000000811';
const staleId = '10000000-0000-4000-8000-000000000812';
const currentId = '10000000-0000-4000-8000-000000000813';
const date = '2026-10-03T14:00:00Z';
const record = (id: string, company: string): AdminSponsorshipRecord => ({
  id,
  version: 'synthetic-v1',
  public_reference: 'SYNTHETIC-' + id.slice(-3),
  contribution_type: 'sponsorship_interest',
  amount: 500,
  currency: 'CAD',
  payment_status: 'paid',
  paid_at: date,
  public_name: null,
  public_display_consent: true,
  display_amount_consent: false,
  sponsor_company_name: company,
  sponsor_contact_name: 'Synthetic contact',
  sponsor_contact_email: 'synthetic@example.test',
  sponsor_website_url: null,
  sponsor_logo_url: null,
  sponsor_message: null,
  sponsor_details_submitted_at: date,
  sponsor_review_status: 'approved',
  sponsor_review_note: null,
  sponsor_reviewed_at: date,
  sponsor_public_slug: null,
  sponsor_public_summary: null,
  sponsor_feed_target: null,
  sponsor_feed_channels: [],
  sponsor_feed_status: 'not_planned',
  sponsor_feed_public_url: null,
  sponsor_feed_notes: null,
  sponsor_visibility_updated_at: null,
  sponsorship_refund_status: 'not_requested',
  sponsorship_refund_requested_at: null,
  sponsorship_refund_processed_at: null,
  sponsorship_refund_completed_at: null,
  sponsorship_refund_id: null,
  sponsorship_refund_amount: null,
  sponsorship_refund_reason: null,
  sponsorship_refund_note: null,
  sponsorship_refund_error: null,
  admin_audit_entries: [],
  created_at: date,
  updated_at: date
});
const response = (item: AdminSponsorshipRecord) => ({
  data_source: 'database',
  items: [item],
  sponsorships: [item],
  last_updated_at: date,
  pagination: {
    page: 1,
    pageSize: 6,
    totalItems: 1,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false
  }
});

for (const { locale, width, lateStatus } of [
  { locale: 'fr', width: 1280, lateStatus: 200 },
  { locale: 'en', width: 390, lateStatus: 503 }
]) {
  test(`sponsor list retains its newer filters after a late ${lateStatus} response in ${locale} at ${width}px`, async ({
    page
  }) => {
    const calls: { method: string; url: URL }[] = [];
    let releaseOld: (() => void) | undefined;
    let oldSeen: (() => void) | undefined;
    const delayed = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const seen = new Promise<void>((resolve) => {
      oldSeen = resolve;
    });
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'openg7-admin-session-token',
        'openg7-admin-session.cookie'
      );
      sessionStorage.setItem(
        'openg7-admin-session-expires-at',
        '2099-01-01T00:00:00Z'
      );
    });
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      calls.push({ method: request.method(), url });
      if (url.pathname === '/api/admin/auth/current')
        return route.fulfill({
          json: {
            id: 'synthetic-list-user',
            sessionId: 'synthetic-list-session',
            displayName: 'Synthetic user',
            role: 'reader',
            expiresAt: '2099-01-01T00:00:00Z'
          }
        });
      if (url.pathname === '/api/admin/sponsorships') {
        const search = url.searchParams.get('search');
        if (search && !url.searchParams.has('reviewStatus')) {
          oldSeen?.();
          await delayed;
          return lateStatus === 200
            ? route.fulfill({
                json: response(record(staleId, 'Synthetic delayed stale'))
              })
            : route.fulfill({
                status: lateStatus,
                json: { error: 'Synthetic delayed failure' }
              });
        }
        return route.fulfill({
          json: response(
            search
              ? record(currentId, 'Synthetic delayed approved')
              : record(initialId, 'Synthetic initial')
          )
        });
      }
      if (url.pathname === '/api/admin/attention')
        return route.fulfill({
          json: {
            available: true,
            coverage: 'complete',
            missingSources: [],
            generatedAt: date,
            timezone: 'America/Toronto',
            total: 0,
            filteredTotal: 0,
            todayTotal: 0,
            counts: { urgent: 0, today: 0, this_week: 0, informational: 0 },
            typeCounts: {},
            actionCounts: {},
            page: 1,
            pageSize: 25,
            items: [],
            firstSponsorshipId: null
          }
        });
      return route.fulfill({
        status: 503,
        json: { error: 'Synthetic fixture unavailable' }
      });
    });
    try {
      await page.goto('/admin/fundraiser/sponsors');
      const list = page.locator('[data-og7="sponsors-list"]');
      await expect(
        list.locator(`[data-og7="sponsor-row"][data-og7-id="${initialId}"]`)
      ).toBeVisible();
      if (locale === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const search = list.getByRole('searchbox');
      await search.fill('Synthetic delayed');
      await seen;
      await list.locator('summary').click();
      await list.getByRole('combobox').first().selectOption('approved');
      const current = list.locator(
        `[data-og7="sponsor-row"][data-og7-id="${currentId}"]`
      );
      await expect(current).toBeVisible();
      const late = page.waitForResponse((entry) => {
        const url = new URL(entry.url());
        return (
          url.pathname === '/api/admin/sponsorships' &&
          Boolean(url.searchParams.get('search')) &&
          !url.searchParams.has('reviewStatus')
        );
      });
      releaseOld?.();
      await (await late).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      await expect(current).toBeVisible();
      await expect(
        list.locator(`[data-og7="sponsor-row"][data-og7-id="${staleId}"]`)
      ).toHaveCount(0);
      await expect(search).toHaveValue('Synthetic delayed');
      await expect(list.getByRole('combobox').first()).toHaveValue('approved');
      expect(
        calls
          .filter(({ url }) => url.pathname === '/api/admin/sponsorships')
          .at(-1)
          ?.url.searchParams.get('reviewStatus')
      ).toBe('approved');
      expect(calls.every(({ method }) => method === 'GET')).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await search.focus();
      await expect(search).toBeFocused();
    } finally {
      releaseOld?.();
    }
  });
}
