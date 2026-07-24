import { expect, test } from './support/test.js';
import type { APIRequestContext } from '@playwright/test';

import { ADMIN_TOKEN, SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';

// Drives the real admin refund route (POST /api/admin/sponsorships/refund)
// directly rather than through the UI, the same way this app's own
// optimistic-lock mechanism is keyed: by `expectedVersion`
// (fund_contributions.updated_at), captured from a prior read and compared
// server-side (see apps/funding-api/src/main.ts). Direct API calls make the
// two scenarios below deterministic instead of racing real browser timing.
//
// Both refunds now go through the Stripe API stub (tests/stripe-stub/)
// instead of the createDevelopmentRefundResult dev-mode mock, because the
// E2E stack configures a (fake but non-empty) STRIPE_SECRET_KEY -- see
// scripts/playwright-docker-up.mjs. That matters here specifically: the
// stub reproduces Stripe's own cumulative-refund-amount guard, which is the
// only thing that catches test 90's scenario (see
// tests/stripe-stub/server.mjs) -- the application code's own per-request
// cap alone does not.

const findSponsorshipBySearch = async (
  request: APIRequestContext,
  search: string
): Promise<{ id: string; version: string }> => {
  const response = await request.get(
    `/api/admin/sponsorships?search=${encodeURIComponent(search)}&pageSize=5`,
    { headers: { 'x-funding-admin-token': ADMIN_TOKEN } }
  );
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.items?.length).toBeGreaterThan(0);
  return body.items[0];
};

const postRefund = (
  request: APIRequestContext,
  body: Record<string, unknown>
) =>
  request.post('/api/admin/sponsorships/refund', {
    headers: { 'x-funding-admin-token': ADMIN_TOKEN },
    data: body
  });

test.describe('Admin refund integrity', () => {
  test('rejects a second partial refund that would push the cumulative total past the original payment amount', async ({
    request
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.multiPartialRefund;
    const sponsorship = await findSponsorshipBySearch(
      request,
      fixture.companyName
    );

    // First partial refund: 60% of the original $1000.00. On its own this
    // is well within the single-request cap (amount <= amountCents).
    const first = await postRefund(request, {
      contributionId: sponsorship.id,
      expectedVersion: sponsorship.version,
      confirmationText: fixture.publicReference,
      amount: 600
    });
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.refunded).toBe(true);

    // Re-fetch to pick up the version the first refund just bumped -- the
    // same thing the admin UI does when the refund panel is reopened.
    const sponsorshipAfterFirst = await findSponsorshipBySearch(
      request,
      fixture.companyName
    );

    // A second 60% partial refund is, again, individually within the cap
    // (still <= the $1000.00 original amount), but its cumulative total
    // with the first ($1200.00) is not. Only the Stripe-equivalent
    // cumulative guard (tests/stripe-stub/server.mjs) catches this.
    const second = await postRefund(request, {
      contributionId: sponsorshipAfterFirst.id,
      expectedVersion: sponsorshipAfterFirst.version,
      confirmationText: fixture.publicReference,
      amount: 600
    });
    expect(second.status()).toBe(502);
    const secondBody = await second.json();
    expect(secondBody.error).toMatch(/exceed/i);
  });

  test('prevents a second administrator from refunding the same sponsorship using a stale version', async ({
    request
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.concurrentRefund;
    // Both "administrators" open the sponsorship detail panel before either
    // submits, so both capture the exact same version.
    const sponsorship = await findSponsorshipBySearch(
      request,
      fixture.companyName
    );

    const adminA = await postRefund(request, {
      contributionId: sponsorship.id,
      expectedVersion: sponsorship.version,
      confirmationText: fixture.publicReference
    });
    expect(adminA.status()).toBe(200);
    const adminABody = await adminA.json();
    expect(adminABody.refunded).toBe(true);

    // Admin B submits using the version captured before Admin A's refund --
    // by now stale, since Admin A's own update already bumped updated_at.
    const adminB = await postRefund(request, {
      contributionId: sponsorship.id,
      expectedVersion: sponsorship.version,
      confirmationText: fixture.publicReference
    });
    expect(adminB.status()).toBe(409);
    const adminBBody = await adminB.json();
    expect(adminBBody.code).toBe('SPONSORSHIP_CONCURRENT_UPDATE');
  });
});
