import { expect, test } from './support/test.js';

import { ADMIN_TOKEN, WEBHOOK_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import {
  buildCheckoutSessionCompletedEvent,
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest
} from './support/stripe-webhook.js';

// Covers Stripe webhook idempotence end to end: real signed HTTP requests
// against /api/stripe/webhook, backed by the Stripe API stub
// (tests/stripe-stub/) so payment_intent.succeeded can resolve a real
// charge/balance transaction without a live Stripe account. The previous
// version of this file never actually posted a webhook -- see git history --
// it only checked pre-seeded UI state.

test.describe('Stripe webhook idempotence', () => {
  test('processes a payment_intent.succeeded webhook exactly once when Stripe delivers it multiple times', async ({
    request
  }) => {
    const fixture = WEBHOOK_FIXTURES.idempotence;
    const event = buildPaymentIntentSucceededEvent({
      eventId: fixture.stripeEventId,
      paymentIntentId: fixture.stripePaymentIntentId,
      chargeId: fixture.stripeChargeId,
      amountCents: fixture.amountCents
    });
    const signed = buildSignedWebhookRequest(event);

    const before = await (
      await request.get('/api/public/fund-transparency')
    ).json();

    const first = await request.post('/api/stripe/webhook', {
      data: signed.body,
      headers: signed.headers
    });
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.duplicate).toBeFalsy();

    const afterFirst = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    expect(afterFirst.total_received - before.total_received).toBeCloseTo(
      fixture.amountCents / 100,
      2
    );
    expect(afterFirst.total_fees - before.total_fees).toBeCloseTo(
      fixture.feeCents / 100,
      2
    );

    // Stripe re-delivers the exact same event (same event id) after a
    // retry, a redeploy, or an operator resend. The stripe_events unique
    // constraint (apps/funding-api/src/fund-contributions.repository.ts,
    // insertStripeEventRecord) must reject reprocessing it.
    const second = await request.post('/api/stripe/webhook', {
      data: signed.body,
      headers: signed.headers
    });
    expect(second.status()).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.duplicate).toBe(true);

    const afterSecond = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    expect(afterSecond.total_received).toBeCloseTo(afterFirst.total_received, 2);
    expect(afterSecond.total_fees).toBeCloseTo(afterFirst.total_fees, 2);
  });

  test('replays a resent Stripe event without duplicating the sponsorship invoice or follow-up email', async ({
    request
  }) => {
    const fixture = WEBHOOK_FIXTURES.replaySponsorship;
    const buildEvent = (eventId: string) =>
      buildCheckoutSessionCompletedEvent({
        eventId,
        sessionId: fixture.stripeSessionId,
        amountCents: fixture.amountCents,
        publicReference: fixture.publicReference,
        followupToken: fixture.followupToken,
        contactEmail: fixture.contactEmail
      });

    // Two *different* event ids describing the same checkout session --
    // this is what Stripe's own "resend event" produces, and is the case
    // that actually exercises session-scoped idempotency (the
    // `stripe-session:${session.id}:...` email keys and the
    // sponsorship_invoices ON CONFLICT (contribution_id) upsert), as
    // opposed to test 79's same-event-id replay, which the top-level
    // stripe_events gate alone already short-circuits.
    const firstSigned = buildSignedWebhookRequest(
      buildEvent(fixture.stripeEventIdFirst)
    );
    const first = await request.post('/api/stripe/webhook', {
      data: firstSigned.body,
      headers: firstSigned.headers
    });
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    // Not asserting followupEmailSent: true here -- SMTP is disabled in this
    // stack (SMTP_ENABLED=false, see docker-compose.yml), so the queued
    // email always fails to actually send, by the same design documented in
    // EMAIL_QUEUE_FIXTURE's comment. `updated: true` confirms the
    // contribution itself was created from this checkout session.
    expect(firstBody.updated).toBe(true);

    const resendSigned = buildSignedWebhookRequest(
      buildEvent(fixture.stripeEventIdResend)
    );
    const resend = await request.post('/api/stripe/webhook', {
      data: resendSigned.body,
      headers: resendSigned.headers
    });
    expect(resend.status()).toBe(200);
    const resendBody = await resend.json();
    // The resend is not rejected as a duplicate at the event-id level (it's
    // a genuinely different event id) -- it is fully reprocessed, and it is
    // the *session-scoped* idempotency underneath that must hold.
    expect(resendBody.duplicate).toBeFalsy();

    const invoicesResponse = await request.get(
      '/api/admin/sponsorship-invoices',
      { headers: { 'x-funding-admin-token': ADMIN_TOKEN } }
    );
    expect(invoicesResponse.ok()).toBe(true);
    const invoicesBody = await invoicesResponse.json();
    const matchingInvoices = (invoicesBody.invoices ?? []).filter(
      (invoice: { stripe_session_id?: string }) =>
        invoice.stripe_session_id === fixture.stripeSessionId
    );
    expect(matchingInvoices).toHaveLength(1);

    const contributionsResponse = await request.get(
      '/api/admin/contributions',
      { headers: { 'x-funding-admin-token': ADMIN_TOKEN } }
    );
    expect(contributionsResponse.ok()).toBe(true);
    const contributionsBody = await contributionsResponse.json();
    const matchingContributions = (
      contributionsBody.contributions ?? []
    ).filter(
      (contribution: { public_reference?: string }) =>
        contribution.public_reference === fixture.publicReference
    );
    expect(matchingContributions).toHaveLength(1);
  });
});
