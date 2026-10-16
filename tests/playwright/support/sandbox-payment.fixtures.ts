import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';
import type {
  AdminContributionRecord,
  AdminContributionsResponse,
  AdminPaymentJourney,
  CheckoutRequest,
  ContributionType
} from '@openg7/funding-core';
import { createSponsorshipOfferSnapshot } from '@openg7/funding-core';

const date = '2026-10-15T12:00:00Z';

interface Attempt {
  checkoutId: string;
  contributionId: string;
  input: CheckoutRequest;
  providerSucceeded: boolean;
}

/** UI-only responses. This fixture never represents proof of a server-confirmed payment. */
export async function sandboxPaymentFixtures(page: Page) {
  const state = {
    attempts: [] as Attempt[],
    providerCalls: [] as { checkoutId: string; body: string }[],
    privateReads: 0,
    privatePaid: true,
    providerFails: false,
    providerGate: null as Promise<void> | null,
    redirect: null as string | null
  };
  await page.route('**/api/sponsorship-offer?*', async (route) => {
    const url = new URL(route.request().url());
    const snapshot = createSponsorshipOfferSnapshot(
      Number(url.searchParams.get('amountMinor')),
      'CAD'
    );
    await route.fulfill({
      json: {
        ...snapshot,
        fingerprint: createHash('sha256')
          .update(JSON.stringify(snapshot))
          .digest('hex')
      }
    });
  });
  await page.route('**/api/sponsorship-charter', (route) =>
    route.fulfill({
      json: { active: false, policyVersion: 'sandbox-ui-fixture' }
    })
  );
  await page.route('**/api/checkout-sessions', async (route) => {
    const input = route.request().postDataJSON() as CheckoutRequest;
    const index = state.attempts.length + 1;
    const attempt = {
      checkoutId: `cs_test_virtual_${index}`,
      contributionId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      input,
      providerSucceeded: false
    };
    state.attempts.push(attempt);
    await route.fulfill({
      json: {
        status: 'redirected',
        checkoutId: attempt.checkoutId,
        redirectUrl:
          state.redirect ?? `/__sandbox/stripe/checkout/${attempt.checkoutId}`
      }
    });
  });
  await page.route('**/__sandbox/stripe/checkout/*', async (route) => {
    const checkoutId = new URL(route.request().url()).pathname
      .split('/')
      .at(-1)!;
    const attempt = state.attempts.find(
      (item) => item.checkoutId === checkoutId
    );
    if (!attempt)
      throw new Error('The UI used an unknown Checkout identifier.');
    state.providerCalls.push({
      checkoutId,
      body: route.request().postData() ?? ''
    });
    if (state.providerGate) await state.providerGate;
    if (state.providerFails)
      return route.fulfill({
        status: 502,
        body: 'Synthetic provider unavailable'
      });
    attempt.providerSucceeded = true;
    return route.fulfill({
      contentType: 'text/html',
      body: '<p>Simulated return only</p>'
    });
  });
  await page.route('**/api/admin/contributions*', async (route) => {
    state.privateReads++;
    const records = state.attempts.map((attempt): AdminContributionRecord => ({
      id: attempt.contributionId,
      public_reference: 'SIM-VIRTUAL-' + attempt.checkoutId.split('_').at(-1),
      contribution_type: attempt.input.contributionType!,
      amount: attempt.input.amount,
      currency: 'CAD',
      payment_status:
        attempt.providerSucceeded && state.privatePaid ? 'paid' : 'pending',
      paid_at: attempt.providerSucceeded && state.privatePaid ? date : null,
      public_name: attempt.input.publicDisplayName ?? null,
      email_private: 'controller@simulation.example.test',
      public_display_consent: attempt.input.publicDisplayConsent ?? false,
      display_amount_consent: false,
      non_charity_acknowledged: true,
      sponsor_company_name: null,
      sponsor_contact_name: null,
      sponsor_contact_email: null,
      sponsor_review_status: null,
      sponsor_feed_status: null,
      stripe_session_id: attempt.checkoutId,
      stripe_payment_intent_id: null,
      created_at: date,
      updated_at: date
    }));
    const response: AdminContributionsResponse = {
      data_source: 'database',
      contributions: records,
      last_updated_at: date,
      summary: {
        total_count: records.length,
        paid_count: records.filter((item) => item.payment_status === 'paid')
          .length,
        pending_count: records.filter((item) => item.payment_status !== 'paid')
          .length,
        sponsorship_count: records.filter(
          (item) => item.contribution_type === 'sponsorship_interest'
        ).length,
        public_display_count: records.filter(
          (item) => item.public_display_consent
        ).length,
        total_received: records
          .filter((item) => item.payment_status === 'paid')
          .reduce((sum, item) => sum + item.amount, 0),
        total_refunded: 0,
        total_disputed: 0,
        currency: 'CAD'
      }
    };
    await route.fulfill({ json: response });
  });
  await page.route('**/api/admin/payment-journey?*', async (route) => {
    const id = new URL(route.request().url()).searchParams.get(
      'contributionId'
    );
    const attempt = state.attempts.find((item) => item.contributionId === id);
    if (!attempt || !attempt.providerSucceeded || !state.privatePaid)
      return route.fulfill({
        json: { status: 'not_found', generatedAt: date, journey: null }
      });
    const personal = attempt.input.contributionType === 'personal_support';
    const next = {
      reason: personal ? 'communications_pending' : 'review_pending',
      adminUrl: personal
        ? '/admin/fundraiser/email-queue'
        : `/admin/fundraiser/sponsors?sponsorshipId=${attempt.contributionId}`
    };
    const journey: AdminPaymentJourney = {
      contributionId: attempt.contributionId,
      reference: 'SIM-VIRTUAL-' + attempt.checkoutId.split('_').at(-1),
      contributionType: attempt.input.contributionType as ContributionType,
      amountMinor: attempt.input.amount * 100,
      currency: 'CAD',
      paymentStatus: 'paid',
      state: personal ? 'waiting' : 'action_required',
      completed: 1,
      total: 2,
      steps: [
        {
          id: 'payment',
          state: 'complete',
          reason: 'payment_recorded',
          adminUrl: '/admin/fundraiser/contributions?contributionId=' + id
        },
        {
          id: personal ? 'communications' : 'review',
          state: 'pending',
          ...next
        }
      ],
      next
    };
    return route.fulfill({
      json: { status: 'ok', generatedAt: date, journey }
    });
  });
  return state;
}
