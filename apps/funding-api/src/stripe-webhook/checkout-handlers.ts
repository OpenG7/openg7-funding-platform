import type Stripe from 'stripe';
import type { Pool } from 'pg';

import { normalizeContributionPublicReference } from '../contribution-public-reference.js';
import { resolvePaymentIntentId } from '../stripe-object-normalization.js';
import {
  markSponsorshipFollowupEmailResult,
  normalizeContributionType,
  parseMetadataBoolean,
  upsertCheckoutSessionFromWebhook
} from '../fund-contributions.repository.js';
import {
  queueSponsorshipInvoiceEmail,
  queueSponsorshipFollowupEmail
} from '../email-notification.service.js';
import { createSponsorshipInvoiceForStripeSession } from '../sponsorship-invoices.repository.js';
import { hasContributionActivityForSession } from '../contribution-activity.repository.js';
import {
  buildSponsorshipFollowupUrl,
  sponsorshipFollowupLocaleFromUrl
} from '../sponsorship-followup-links.js';

import { toIsoFromUnix } from './event-time.js';

interface CheckoutHandlerDependencies {
  readonly pool: Pool | null;
  readonly publicBaseUrl: string;
}

const sponsorshipFollowupTokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

const extractSponsorshipFollowupTokenFromUrl = (
  value: string | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  try {
    const searchParams = new URL(value).searchParams;
    const token =
      searchParams.get('followup_token') ?? searchParams.get('token');
    return token && sponsorshipFollowupTokenPattern.test(token) ? token : null;
  } catch {
    return null;
  }
};

const extractSponsorshipFollowupTokenFromSession = (
  session: Stripe.Checkout.Session
): string | null => {
  const tokenFromSuccessUrl = extractSponsorshipFollowupTokenFromUrl(
    session.success_url
  );
  if (tokenFromSuccessUrl) {
    return tokenFromSuccessUrl;
  }

  const legacyToken = session.metadata?.sponsorshipFollowupToken;
  return legacyToken && sponsorshipFollowupTokenPattern.test(legacyToken)
    ? legacyToken
    : null;
};

const buildCheckoutSessionWebhookInput = (
  session: Stripe.Checkout.Session,
  status: 'pending' | 'paid' | 'expired'
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
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const status = session.payment_status === 'paid' ? 'paid' : 'pending';
    const sessionMetadata = session.metadata ?? {};
    const updated = await upsertCheckoutSessionFromWebhook(pool, {
      ...buildCheckoutSessionWebhookInput(session, status),
      notifyAdmin: true
    });
    const isSponsorship =
      normalizeContributionType(sessionMetadata.contributionType) ===
      'sponsorship_interest';
    const followupToken = extractSponsorshipFollowupTokenFromSession(session);
    const followupEmail = session.customer_details?.email;
    const publicReference = normalizeContributionPublicReference(
      sessionMetadata.publicReference ?? session.client_reference_id
    );
    let followupEmailSent = false;
    let sponsorshipInvoiceEmailSent = false;

    if (
      status === 'paid' &&
      isSponsorship &&
      pool &&
      followupToken &&
      followupEmail &&
      (await hasContributionActivityForSession(pool, session.id))
    ) {
      const followupUrl = buildSponsorshipFollowupUrl(
        publicBaseUrl,
        followupToken,
        sponsorshipFollowupLocaleFromUrl(session.success_url)
      );
      const sendResult = await queueSponsorshipFollowupEmail(pool, {
        idempotencyKey: `stripe-session:${session.id}:sponsorship-followup`,
        deferDelivery: true,
        to: followupEmail,
        publicReference,
        followupUrl
      });
      followupEmailSent = sendResult.sent;

      await markSponsorshipFollowupEmailResult(pool, {
        stripeSessionId: session.id,
        sentAtIso: sendResult.sent ? new Date().toISOString() : undefined,
        error: sendResult.sent ? null : sendResult.error
      });

      const invoice = await createSponsorshipInvoiceForStripeSession(pool, {
        stripeSessionId: session.id,
        stripePaymentIntentId: resolvePaymentIntentId(session.payment_intent),
        publicReference,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? 'cad',
        paidAtIso: toIsoFromUnix(session.created),
        customerEmail: followupEmail
      });

      if (invoice) {
        const invoiceResult = await queueSponsorshipInvoiceEmail(pool, {
          idempotencyKey: `stripe-session:${session.id}:sponsorship-invoice`,
          deferDelivery: true,
          to: followupEmail,
          invoice,
          followupUrl
        });
        sponsorshipInvoiceEmailSent = invoiceResult.sent;
      }
    }

    return {
      received: true,
      updated,
      followupEmailSent,
      sponsorshipInvoiceEmailSent
    };
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    const updated = await upsertCheckoutSessionFromWebhook(pool, {
      ...buildCheckoutSessionWebhookInput(session, 'expired'),
      notifyAdmin: true
    });

    return {
      received: true,
      updated
    };
  }

  return { received: true, ignored: true };
};
