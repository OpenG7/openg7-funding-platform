import type Stripe from 'stripe';
import type { Pool } from 'pg';

import { normalizeContributionPublicReference } from '../contribution-public-reference.js';
import { resolvePaymentIntentId } from '../stripe-object-normalization.js';
import {
  normalizeContributionType,
  parseMetadataBoolean,
  upsertCheckoutSessionFromWebhook
} from '../fund-contributions.repository.js';

import { toIsoFromUnix } from './event-time.js';
import { finalizeSponsorshipPayment } from './sponsorship-payment-finalization.js';

interface CheckoutHandlerDependencies {
  readonly pool: Pool | null;
  readonly publicBaseUrl: string;
}

const buildCheckoutSessionWebhookInput = (
  session: Stripe.Checkout.Session,
  status: 'pending' | 'paid' | 'expired' | 'failed'
): Parameters<typeof upsertCheckoutSessionFromWebhook>[1] => {
  const metadata = session.metadata ?? {};
  const amountCents = session.amount_total ?? 0;
  const paidAtIso = status === 'paid' ? toIsoFromUnix(session.created) : null;

  return {
    stripeSessionId: session.id,
    stripePaymentIntentId: resolvePaymentIntentId(session.payment_intent),
    publicReference: normalizeContributionPublicReference(
      metadata.publicReference ?? session.client_reference_id
    ),
    contributionType: normalizeContributionType(metadata.contributionType),
    amountCents,
    currency: session.currency ?? 'cad',
    metadata,
    publicDisplayConsent: parseMetadataBoolean(metadata.publicDisplayConsent),
    publicName: metadata.publicDisplayName ?? null,
    displayAmountConsent: parseMetadataBoolean(metadata.displayAmountConsent),
    nonCharityAcknowledged: parseMetadataBoolean(
      metadata.nonCharityAcknowledged
    ),
    sponsorshipFollowupTokenHash: metadata.sponsorshipFollowupTokenHash ?? null,
    status,
    paidAtIso,
    emailPrivate: session.customer_details?.email ?? null
  };
};

export const handleStripeCheckoutEvent = async (
  event: Stripe.Event,
  { pool, publicBaseUrl }: CheckoutHandlerDependencies
): Promise<Record<string, unknown>> => {
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const status = session.payment_status === 'paid' ? 'paid' : 'pending';
    const updated = await upsertCheckoutSessionFromWebhook(pool, {
      ...buildCheckoutSessionWebhookInput(session, status),
      notifyAdmin: true
    });
    const finalized = await finalizeSponsorshipPayment(
      pool,
      session,
      publicBaseUrl
    );

    return {
      received: true,
      updated,
      ...finalized
    };
  }

  if (
    event.type === 'checkout.session.expired' ||
    event.type === 'checkout.session.async_payment_failed'
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const updated = await upsertCheckoutSessionFromWebhook(pool, {
      ...buildCheckoutSessionWebhookInput(
        session,
        event.type === 'checkout.session.expired' ? 'expired' : 'failed'
      ),
      notifyAdmin: true
    });

    return {
      received: true,
      updated
    };
  }

  return { received: true, ignored: true };
};
