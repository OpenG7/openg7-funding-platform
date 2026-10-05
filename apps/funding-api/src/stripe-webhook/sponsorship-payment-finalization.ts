import type Stripe from 'stripe';
import type { Pool } from 'pg';

import { resolvePaymentIntentId } from '../stripe-object-normalization.js';
import { stripeSessionBelongsToProject } from '../stripe-project-scope.js';
import { hasContributionActivityForSession } from '../contribution-activity.repository.js';
import { markSponsorshipFollowupEmailResult } from '../fund-contributions.repository.js';
import { createSponsorshipInvoiceForStripeSession } from '../sponsorship-invoices.repository.js';
import {
  queueSponsorshipFollowupEmail,
  queueSponsorshipInvoiceEmail
} from '../email-notification.service.js';
import {
  buildSponsorshipFollowupUrl,
  sponsorshipFollowupLocaleFromUrl
} from '../sponsorship-followup-links.js';

const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const followupToken = (session: Stripe.Checkout.Session): string | null => {
  try {
    const params = new URL(session.success_url ?? '').searchParams;
    const token = params.get('followup_token') ?? params.get('token');
    if (token && tokenPattern.test(token)) return token;
  } catch {
    // Older sessions can keep the token in metadata instead.
  }
  const legacy = session.metadata?.sponsorshipFollowupToken;
  return legacy && tokenPattern.test(legacy) ? legacy : null;
};

/** All confirmations use the same persisted eligibility and logical email keys. */
export const finalizeSponsorshipPayment = async (
  pool: Pool | null,
  session: Stripe.Checkout.Session,
  publicBaseUrl: string
): Promise<{
  followupEmailSent: boolean;
  sponsorshipInvoiceEmailSent: boolean;
}> => {
  const result = {
    followupEmailSent: false,
    sponsorshipInvoiceEmailSent: false
  };
  if (!pool) return result;
  const contribution = (
    await pool.query<{
      public_reference: string | null;
      email_private: string | null;
      paid_at: Date | null;
      amount_cents: string;
      currency: string;
    }>(
      `SELECT public_reference,email_private,paid_at,amount_cents::text,currency
     FROM fund_contributions WHERE stripe_session_id=$1 AND status='paid'
       AND contribution_type='sponsorship_interest'
       AND amount_cents=$2 AND currency=$3
       AND stripe_payment_intent_id IS NOT DISTINCT FROM $4`,
      [
        session.id,
        session.amount_total ?? 0,
        session.currency ?? 'cad',
        resolvePaymentIntentId(session.payment_intent)
      ]
    )
  ).rows[0];
  if (
    !contribution ||
    !(await hasContributionActivityForSession(pool, session.id))
  )
    return result;

  const token = followupToken(session);
  const followupUrl = token
    ? buildSponsorshipFollowupUrl(
        publicBaseUrl,
        token,
        sponsorshipFollowupLocaleFromUrl(session.success_url)
      )
    : undefined;
  const email = contribution.email_private ?? session.customer_details?.email;
  // A confirmed financial document does not depend on a recovery token/email.
  const invoice = await createSponsorshipInvoiceForStripeSession(pool, {
    stripeSessionId: session.id,
    stripePaymentIntentId: resolvePaymentIntentId(session.payment_intent),
    publicReference: contribution.public_reference,
    amountCents: Number(contribution.amount_cents),
    currency: contribution.currency,
    paidAtIso: contribution.paid_at?.toISOString() ?? null,
    customerEmail: email ?? null
  });
  if (!email) return result;
  if (followupUrl) {
    const queued = await queueSponsorshipFollowupEmail(pool, {
      idempotencyKey: `stripe-session:${session.id}:sponsorship-followup`,
      deferDelivery: true,
      to: email,
      publicReference: contribution.public_reference,
      followupUrl
    });
    if (!queued.messageId)
      throw new Error('SPONSORSHIP_PAYMENT_EMAIL_QUEUE_FAILED');
    result.followupEmailSent = queued.sent;
    await markSponsorshipFollowupEmailResult(pool, {
      stripeSessionId: session.id,
      sentAtIso: queued.sent ? new Date().toISOString() : undefined,
      error: queued.error
    });
  }
  if (invoice) {
    const queued = await queueSponsorshipInvoiceEmail(pool, {
      idempotencyKey: `stripe-session:${session.id}:sponsorship-invoice`,
      deferDelivery: true,
      to: email,
      invoice,
      followupUrl
    });
    if (!queued.messageId)
      throw new Error('SPONSORSHIP_PAYMENT_EMAIL_QUEUE_FAILED');
    result.sponsorshipInvoiceEmailSent = queued.sent;
  }
  return result;
};

export const finalizeSponsorshipPaymentIntent = async (
  pool: Pool | null,
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent,
  projectId: string,
  publicBaseUrl: string
): Promise<void> => {
  if (!pool) return;
  const sessions = await pool.query<{ stripe_session_id: string }>(
    `SELECT stripe_session_id FROM fund_contributions
     WHERE stripe_payment_intent_id=$1 AND status='paid'
       AND contribution_type='sponsorship_interest' AND stripe_session_id IS NOT NULL`,
    [paymentIntent.id]
  );
  for (const row of sessions.rows) {
    if (!(await hasContributionActivityForSession(pool, row.stripe_session_id)))
      continue;
    const session = await stripe.checkout.sessions.retrieve(
      row.stripe_session_id
    );
    if (
      resolvePaymentIntentId(session.payment_intent) !== paymentIntent.id ||
      !stripeSessionBelongsToProject(session, paymentIntent, projectId)
    )
      throw new Error('SPONSORSHIP_CHECKOUT_PAYMENT_MISMATCH');
    await finalizeSponsorshipPayment(pool, session, publicBaseUrl);
  }
};
