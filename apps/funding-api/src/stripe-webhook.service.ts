import Stripe from 'stripe';
import type { Pool } from 'pg';

import {
  insertStripeEventRecord,
  markSponsorshipFollowupEmailResult,
  markStripeEventFailed,
  markStripeEventProcessed,
  normalizeContributionType,
  parseMetadataBoolean,
  updateContributionStatusByPaymentIntent,
  updateSponsorshipRefundWorkflowStatusByPaymentIntent,
  upsertCheckoutSessionFromWebhook
} from './fund-contributions.repository.js';
import {
  queueSponsorshipInvoiceEmail,
  queueSponsorshipFollowupEmail
} from './email-notification.service.js';
import {
  insertFundTransaction,
  updateContributionFundTransactionBalance
} from './fund-transparency.repository.js';
import { createSponsorshipInvoiceForStripeSession } from './sponsorship-invoices.repository.js';

interface ProcessWebhookDependencies {
  readonly stripe: Stripe;
  readonly webhookSecret: string;
  readonly pool: Pool | null;
  readonly publicBaseUrl: string;
}

const allowedEvents = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.updated',
  'charge.refunded',
  'charge.dispute.created',
  'payout.paid',
  'payout.failed'
]);

const sponsorshipFollowupTokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const contributionPublicReferencePattern = /^OG7-\d{4}-[A-Z0-9]{4,8}$/;

const toIsoFromUnix = (seconds: number): string =>
  new Date(seconds * 1000).toISOString();

const buildBalanceData = (
  balanceTransaction: Stripe.BalanceTransaction | null,
  fallbackAmount: number,
  fallbackCurrency: string
): {
  readonly stripeBalanceTransactionId: string | null;
  readonly amount: number;
  readonly fee: number;
  readonly net: number;
  readonly currency: string;
} => {
  if (!balanceTransaction) {
    return {
      stripeBalanceTransactionId: null,
      amount: fallbackAmount,
      fee: 0,
      net: fallbackAmount,
      currency: fallbackCurrency
    };
  }

  return {
    stripeBalanceTransactionId: balanceTransaction.id,
    amount: balanceTransaction.amount,
    fee: balanceTransaction.fee,
    net: balanceTransaction.net,
    currency: balanceTransaction.currency
  };
};

const resolveBalanceTransaction = async (
  stripe: Stripe,
  value: string | Stripe.BalanceTransaction | null | undefined
): Promise<Stripe.BalanceTransaction | null> => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return stripe.balanceTransactions.retrieve(value);
  }

  return value;
};

const resolvePaymentIntentId = (
  value: string | Stripe.PaymentIntent | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.id;
};

const buildSponsorshipFollowupUrl = (
  publicBaseUrl: string,
  token: string
): string => {
  const url = new URL('/fonds-des-batisseurs/suivi-commandite', publicBaseUrl);
  url.searchParams.set('token', token);
  return url.toString();
};

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

const normalizeContributionPublicReference = (
  value: string | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  const reference = value.trim().toUpperCase();
  return contributionPublicReferencePattern.test(reference) ? reference : null;
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

export const processStripeWebhook = async (
  rawBody: string,
  signature: string,
  dependencies: ProcessWebhookDependencies
): Promise<{
  readonly statusCode: number;
  readonly payload: Record<string, unknown>;
}> => {
  const { stripe, webhookSecret, pool, publicBaseUrl } = dependencies;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return {
      statusCode: 400,
      payload: {
        error: 'Invalid Stripe webhook signature'
      }
    };
  }

  let eventInserted: boolean;
  try {
    eventInserted = await insertStripeEventRecord(pool, {
      stripeEventId: event.id,
      eventType: event.type,
      payload: event
    });
  } catch (error) {
    console.error('Failed to record Stripe webhook event.', error);
    return {
      statusCode: 500,
      payload: {
        received: false,
        error: 'Webhook event could not be recorded.'
      }
    };
  }

  if (!eventInserted) {
    return {
      statusCode: 200,
      payload: {
        received: true,
        duplicate: true,
        type: event.type
      }
    };
  }

  const acknowledge = async (
    payload: Record<string, unknown>
  ): Promise<{
    readonly statusCode: number;
    readonly payload: Record<string, unknown>;
  }> => {
    await markStripeEventProcessed(pool, event.id);
    return {
      statusCode: 200,
      payload
    };
  };

  if (!allowedEvents.has(event.type)) {
    return acknowledge({
      received: true,
      ignored: true,
      type: event.type
    });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const status = session.payment_status === 'paid' ? 'paid' : 'pending';
      const sessionMetadata = session.metadata ?? {};
      const updated = await upsertCheckoutSessionFromWebhook(
        pool,
        buildCheckoutSessionWebhookInput(session, status)
      );
      const isSponsorship =
        normalizeContributionType(sessionMetadata.contributionType) ===
        'sponsorship_interest';
      const followupToken = extractSponsorshipFollowupTokenFromSession(session);
      const followupEmail = session.customer_details?.email;
      let followupEmailSent = false;
      let sponsorshipInvoiceEmailSent = false;

      if (
        status === 'paid' &&
        isSponsorship &&
        pool &&
        followupToken &&
        followupEmail
      ) {
        const followupUrl = buildSponsorshipFollowupUrl(
          publicBaseUrl,
          followupToken
        );
        const sendResult = await queueSponsorshipFollowupEmail(pool, {
          idempotencyKey: `stripe-session:${session.id}:sponsorship-followup`,
          to: followupEmail,
          followupUrl
        });
        followupEmailSent = sendResult.sent;

        await markSponsorshipFollowupEmailResult(pool, {
          stripeSessionId: session.id,
          sentAtIso: sendResult.sent ? new Date().toISOString() : undefined,
          error: sendResult.sent ? null : sendResult.error
        });

        const publicReference = normalizeContributionPublicReference(
          sessionMetadata.publicReference ?? session.client_reference_id
        );
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
            to: followupEmail,
            invoice,
            followupUrl
          });
          sponsorshipInvoiceEmailSent = invoiceResult.sent;
        }
      }

      return acknowledge({
        received: true,
        updated,
        followupEmailSent,
        sponsorshipInvoiceEmailSent
      });
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const updated = await upsertCheckoutSessionFromWebhook(
        pool,
        buildCheckoutSessionWebhookInput(session, 'expired')
      );

      return acknowledge({
        received: true,
        updated
      });
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const statusUpdated = await updateContributionStatusByPaymentIntent(
        pool,
        {
          stripePaymentIntentId: paymentIntent.id,
          status: 'paid',
          paidAtIso: toIsoFromUnix(paymentIntent.created)
        }
      );

      const chargeId =
        typeof paymentIntent.latest_charge === 'string'
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge?.id;

      const charge = chargeId
        ? await stripe.charges.retrieve(chargeId, {
            expand: ['balance_transaction']
          })
        : null;

      const balanceData = buildBalanceData(
        await resolveBalanceTransaction(stripe, charge?.balance_transaction),
        paymentIntent.amount_received || paymentIntent.amount,
        paymentIntent.currency
      );

      const inserted = await insertFundTransaction(pool, {
        stripeEventId: event.id,
        stripeObjectId: paymentIntent.id,
        stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
        type: event.type,
        amount: paymentIntent.amount_received || paymentIntent.amount,
        fee: balanceData.fee,
        net: balanceData.net,
        currency: balanceData.currency,
        status: paymentIntent.status,
        createdAtIso: toIsoFromUnix(paymentIntent.created),
        publicCategory: 'contribution',
        metadataJson: {
          source: 'stripe',
          project:
            paymentIntent.metadata.project ??
            paymentIntent.metadata.projectId ??
            'openg7',
          eventType: event.type
        }
      });

      return acknowledge({
        received: true,
        inserted,
        statusUpdated
      });
    }

    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const updated = await updateContributionStatusByPaymentIntent(pool, {
        stripePaymentIntentId: paymentIntent.id,
        status: 'failed'
      });

      return acknowledge({
        received: true,
        updated
      });
    }

    if (event.type === 'charge.updated') {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = resolvePaymentIntentId(charge.payment_intent);
      const balanceTransaction = await resolveBalanceTransaction(
        stripe,
        charge.balance_transaction
      );

      if (!paymentIntentId || !balanceTransaction) {
        return acknowledge({
          received: true,
          updated: false,
          hasBalanceTransaction: Boolean(balanceTransaction)
        });
      }

      const balanceData = buildBalanceData(
        balanceTransaction,
        charge.amount,
        charge.currency
      );
      const updated = await updateContributionFundTransactionBalance(pool, {
        stripePaymentIntentId: paymentIntentId,
        stripeBalanceTransactionId: balanceTransaction.id,
        amount: balanceData.amount,
        fee: balanceData.fee,
        net: balanceData.net,
        currency: balanceData.currency,
        status: charge.status
      });

      return acknowledge({
        received: true,
        updated
      });
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = resolvePaymentIntentId(charge.payment_intent);
      const statusUpdated = paymentIntentId
        ? await updateContributionStatusByPaymentIntent(pool, {
            stripePaymentIntentId: paymentIntentId,
            status: 'refunded'
          })
        : false;
      const refundId = charge.refunds?.data?.[0]?.id ?? null;
      const refundWorkflowUpdated = paymentIntentId
        ? await updateSponsorshipRefundWorkflowStatusByPaymentIntent(pool, {
            stripePaymentIntentId: paymentIntentId,
            refundStatus: 'completed',
            refundId,
            refundNote: 'Confirmed by Stripe charge.refunded webhook.'
          })
        : false;
      const balanceData = buildBalanceData(
        await resolveBalanceTransaction(stripe, charge.balance_transaction),
        charge.amount_refunded,
        charge.currency
      );

      const inserted = await insertFundTransaction(pool, {
        stripeEventId: event.id,
        stripeObjectId: charge.id,
        stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
        type: event.type,
        amount: charge.amount_refunded,
        fee: balanceData.fee,
        net: balanceData.net,
        currency: balanceData.currency,
        status: charge.status,
        createdAtIso: toIsoFromUnix(charge.created),
        publicCategory: 'refund',
        metadataJson: {
          source: 'stripe',
          eventType: event.type
        }
      });

      return acknowledge({
        received: true,
        inserted,
        statusUpdated,
        refundWorkflowUpdated
      });
    }

    if (event.type === 'charge.dispute.created') {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = resolvePaymentIntentId(dispute.payment_intent);
      const updated = paymentIntentId
        ? await updateContributionStatusByPaymentIntent(pool, {
            stripePaymentIntentId: paymentIntentId,
            status: 'disputed'
          })
        : false;

      return acknowledge({
        received: true,
        updated
      });
    }

    if (event.type === 'payout.paid' || event.type === 'payout.failed') {
      const payout = event.data.object as Stripe.Payout;
      const balanceData = buildBalanceData(
        await resolveBalanceTransaction(stripe, payout.balance_transaction),
        payout.amount,
        payout.currency
      );

      const inserted = await insertFundTransaction(pool, {
        stripeEventId: event.id,
        stripeObjectId: payout.id,
        stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
        type: event.type,
        amount: payout.amount,
        fee: balanceData.fee,
        net: balanceData.net,
        currency: balanceData.currency,
        status: payout.status,
        createdAtIso: toIsoFromUnix(payout.created),
        publicCategory: 'payout',
        metadataJson: {
          source: 'stripe',
          eventType: event.type
        }
      });

      return acknowledge({
        received: true,
        inserted
      });
    }

    return acknowledge({
      received: true,
      ignored: true
    });
  } catch (error) {
    console.error('Failed to process Stripe webhook event.', error);
    await markStripeEventFailed(pool, event.id);
    return {
      statusCode: 500,
      payload: {
        received: false,
        error: 'Webhook event could not be processed.'
      }
    };
  }
};
