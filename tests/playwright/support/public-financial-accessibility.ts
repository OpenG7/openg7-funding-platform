import type { Page } from '@playwright/test';
import type { FundTransparencyPublicResponse } from '@openg7/funding-core';

import { sponsorshipOfferQuote } from '../sponsorship-offer.ui.js';

const report: FundTransparencyPublicResponse = {
  data_source: 'database',
  total_received: 350,
  total_fees: 8,
  total_net: 342,
  total_refunded: 10,
  total_payouts: 25,
  current_available_estimate: 332,
  contributions_count: 3,
  pending_fee_count: 0,
  currency: 'CAD',
  monthly_summary: [
    {
      month: '2026-09',
      currency: 'CAD',
      total_received: 135,
      total_fees: 3,
      total_net: 132,
      total_refunded: 10,
      total_payouts: 0,
      contributions_count: 1,
      pending_fee_count: 0
    }
  ],
  latest_public_allocations: [
    {
      project_name: 'Synthetic public project',
      public_description: 'Synthetic public description',
      expected_outcome: 'Synthetic public outcome',
      progress_status: 'in_progress',
      proof_url: 'https://example.test/public-proof',
      proof_source: 'Synthetic public proof',
      proof_published_at: '2026-09-18T10:00:00.000Z',
      amount_allocated: 25,
      currency: 'CAD',
      status: 'published',
      published_at: '2026-09-18T10:00:00.000Z'
    }
  ],
  public_builders: [],
  last_updated_at: '2026-09-18T10:00:00.000Z'
};

/** Intercept every API: accessibility checks never create a payment or use a provider. */
export async function installPublicFinancialAccessibilityFixtures(page: Page) {
  const state = { transparencyUnavailable: false, checkouts: 0 };
  await page.clock.setFixedTime(new Date('2026-09-19T12:00:00.000Z'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    switch (url.pathname) {
      case '/api/public/fund-transparency':
        return route.fulfill(
          state.transparencyUnavailable
            ? { status: 503, json: {} }
            : { json: report }
        );
      case '/api/public/funding-config':
        return route.fulfill({
          json: {
            business_sponsorship_enabled: true,
            allowed_contribution_amounts: [5, 10, 25, 50]
          }
        });
      case '/api/public/sponsorship-batches/availability':
        return route.fulfill({
          json: { data_source: 'empty', availability: [], slots: [] }
        });
      case '/api/sponsorship-charter':
        return route.fulfill({
          json: {
            active: false,
            policyVersion: '1.0',
            fingerprint: null,
            text: null
          }
        });
      case '/api/sponsorship-offer':
        return route.fulfill({
          json: sponsorshipOfferQuote(
            Number(url.searchParams.get('amountMinor'))
          )
        });
      case '/api/checkout-sessions':
        state.checkouts++;
        return route.fulfill({ status: 502, json: {} });
      default:
        return route.fulfill({ status: 503, json: {} });
    }
  });
  return state;
}
