import { createHash } from 'node:crypto';

import type { Pool } from 'pg';
import type Stripe from 'stripe';

import { normalizeContributionPublicReference } from '../contribution-public-reference.js';
import {
  normalizeContributionType,
  parseMetadataBoolean,
  updateContributionStatusByPaymentIntent,
  upsertCheckoutSessionFromWebhook
} from '../fund-contributions.repository.js';
import {
  buildBalanceData,
  resolveBalanceTransaction,
  resolveCharge,
  resolvePaymentIntent,
  resolvePaymentIntentId
} from '../stripe-object-normalization.js';
import { stripeSessionBelongsToProject } from '../stripe-project-scope.js';
import { syncStripeChargeRefunds } from '../stripe-refunds.service.js';

import type {
  StripeBackfillOptions,
  StripeBackfillSummary
} from './contracts.js';
import { insertBackfilledFundTransaction } from './repository.js';
import {
  shouldStopAfterScan,
  syntheticStripeEventId,
  toIsoFromUnix
} from './shared.js';
import { applyInsertResult } from './summary.js';

const toMetadataRecord = (
  metadata: Stripe.Metadata | null | undefined
): Record<string, string> => ({ ...(metadata ?? {}) });

const parseMetadataBooleanWithFallback = (
  value: string | undefined,
  fallback: boolean
): boolean => (value === undefined ? fallback : parseMetadataBoolean(value));

const buildFallbackPublicReference = (
  created: number,
  seed: string
): string => {
  const year = new Date(created * 1000).getUTCFullYear();
  const suffix = createHash('sha256')
    .update(seed)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();

  return `OG7-${year}-${suffix}`;
};

const getLatestCharge = async (
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent
): Promise<Stripe.Charge | null> =>
  resolveCharge(stripe, paymentIntent.latest_charge, {
    expand: ['balance_transaction', 'payment_intent']
  });

const buildCheckoutStatus = (
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent | null
): 'pending' | 'paid' | 'expired' => {
  if (
    session.payment_status === 'paid' ||
    paymentIntent?.status === 'succeeded'
  ) {
    return 'paid';
  }

  return session.status === 'expired' ? 'expired' : 'pending';
};

const backfillCheckoutSession = async (
  pool: Pool,
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent | null,
  options: StripeBackfillOptions,
  summary: StripeBackfillSummary
): Promise<void> => {
  const status = buildCheckoutStatus(session, paymentIntent);
  const metadata = {
    ...toMetadataRecord(paymentIntent?.metadata),
    ...toMetadataRecord(session.metadata)
  };
  const publicReference =
    normalizeContributionPublicReference(metadata.publicReference) ??
    normalizeContributionPublicReference(session.client_reference_id) ??
    buildFallbackPublicReference(session.created, session.id);

  summary.checkoutSessions.matched += 1;

  if (options.dryRun) {
    summary.checkoutSessions.dryRunMatched += 1;
    return;
  }

  const updated = await upsertCheckoutSessionFromWebhook(pool, {
    stripeSessionId: session.id,
    stripePaymentIntentId: resolvePaymentIntentId(
      paymentIntent ?? session.payment_intent
    ),
    publicReference,
    contributionType: normalizeContributionType(metadata.contributionType),
    amountCents:
      session.amount_total ??
      paymentIntent?.amount_received ??
      paymentIntent?.amount ??
      0,
    currency: session.currency ?? paymentIntent?.currency ?? 'cad',
    metadata,
    publicDisplayConsent: parseMetadataBoolean(metadata.publicDisplayConsent),
    publicName: metadata.publicDisplayName ?? null,
    displayAmountConsent: parseMetadataBoolean(metadata.displayAmountConsent),
    nonCharityAcknowledged: parseMetadataBooleanWithFallback(
      metadata.nonCharityAcknowledged,
      options.assumeNonCharityAcknowledged
    ),
    sponsorshipFollowupTokenHash: metadata.sponsorshipFollowupTokenHash ?? null,
    status,
    paidAtIso:
      status === 'paid'
        ? toIsoFromUnix(paymentIntent?.created ?? session.created)
        : null,
    emailPrivate: session.customer_details?.email ?? null
  });

  if (updated) {
    summary.checkoutSessions.upserted += 1;
  }
};

const backfillPaymentIntentTransaction = async (
  stripe: Stripe,
  pool: Pool,
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent,
  options: StripeBackfillOptions,
  summary: StripeBackfillSummary
): Promise<Stripe.Charge | null> => {
  if (paymentIntent.status !== 'succeeded') {
    return null;
  }

  summary.paymentIntents.seen += 1;

  if (!options.dryRun) {
    await updateContributionStatusByPaymentIntent(pool, {
      stripePaymentIntentId: paymentIntent.id,
      status: 'paid',
      paidAtIso: toIsoFromUnix(paymentIntent.created)
    });
  }

  const charge = await getLatestCharge(stripe, paymentIntent);
  const balanceTransaction = await resolveBalanceTransaction(
    stripe,
    charge?.balance_transaction
  );

  if (!balanceTransaction) {
    summary.paymentIntents.missingBalanceTransactions += 1;
  }

  const amount =
    paymentIntent.amount_received ||
    session.amount_total ||
    paymentIntent.amount;
  const balanceData = buildBalanceData(
    balanceTransaction,
    amount,
    paymentIntent.currency ?? session.currency ?? 'cad'
  );
  const insertResult = await insertBackfilledFundTransaction(
    pool,
    {
      stripeEventId: syntheticStripeEventId(
        'payment_intent.succeeded',
        paymentIntent.id
      ),
      stripeObjectId: paymentIntent.id,
      stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
      type: 'payment_intent.succeeded',
      amount,
      fee: balanceData.fee,
      net: balanceData.net,
      currency: balanceData.currency,
      status: paymentIntent.status,
      createdAtIso: toIsoFromUnix(paymentIntent.created),
      publicCategory: 'contribution',
      metadataJson: {
        source: 'stripe_backfill',
        project:
          paymentIntent.metadata.project ??
          paymentIntent.metadata.projectId ??
          session.metadata?.project ??
          session.metadata?.projectId ??
          options.projectId,
        checkoutSessionId: session.id,
        eventType: 'payment_intent.succeeded'
      }
    },
    options.dryRun
  );

  applyInsertResult(summary.paymentIntents, insertResult);
  return charge;
};

const backfillRefundTransaction = async (
  stripe: Stripe,
  pool: Pool,
  charge: Stripe.Charge,
  paymentIntentId: string,
  options: StripeBackfillOptions,
  summary: StripeBackfillSummary
): Promise<void> => {
  if (!options.includeRefunds || charge.amount_refunded <= 0) {
    return;
  }

  const result = await syncStripeChargeRefunds(stripe, pool, charge, {
    paymentIntentId,
    source: 'stripe_backfill',
    dryRun: options.dryRun,
    limit: options.maxRecords ?? 100
  });
  summary.refunds.seen += result.seen;
  summary.refunds.skippedExistingTransactions += result.existing;
  if (options.dryRun)
    summary.refunds.dryRunWouldInsertTransactions += result.inserted;
  else summary.refunds.insertedTransactions += result.inserted;
};

const buildCheckoutSessionListParams = (
  options: StripeBackfillOptions
): Stripe.Checkout.SessionListParams => ({
  limit: 100,
  expand: ['data.payment_intent'],
  ...(options.created ? { created: options.created } : {})
});

export const backfillCheckoutSessions = async (
  stripe: Stripe,
  pool: Pool,
  options: StripeBackfillOptions,
  summary: StripeBackfillSummary
): Promise<void> => {
  for await (const session of stripe.checkout.sessions.list(
    buildCheckoutSessionListParams(options)
  )) {
    if (options.deadlineAt && Date.now() >= options.deadlineAt)
      throw new Error('Backfill time limit reached.');
    if (
      shouldStopAfterScan(summary.checkoutSessions.scanned, options.maxRecords)
    ) {
      break;
    }

    summary.checkoutSessions.scanned += 1;

    const paymentIntent = await resolvePaymentIntent(
      stripe,
      session.payment_intent
    );
    const matches =
      options.includeUnmatched ||
      stripeSessionBelongsToProject(session, paymentIntent, options.projectId);

    if (!matches) {
      summary.checkoutSessions.skippedUnmatched += 1;
      continue;
    }

    await backfillCheckoutSession(
      pool,
      session,
      paymentIntent,
      options,
      summary
    );

    if (!paymentIntent) {
      continue;
    }

    const charge = await backfillPaymentIntentTransaction(
      stripe,
      pool,
      session,
      paymentIntent,
      options,
      summary
    );

    if (charge) {
      await backfillRefundTransaction(
        stripe,
        pool,
        charge,
        paymentIntent.id,
        options,
        summary
      );
    }
  }
};
