import { createHash } from 'node:crypto';

import type { Pool } from 'pg';
import Stripe from 'stripe';

import {
  normalizeContributionType,
  parseMetadataBoolean,
  updateContributionStatusByPaymentIntent,
  upsertCheckoutSessionFromWebhook
} from './fund-contributions.repository.js';

export interface StripeBackfillCreatedRange {
  readonly gte?: number;
  readonly lte?: number;
}

export interface StripeBackfillOptions {
  readonly projectId: string;
  readonly includeUnmatched: boolean;
  readonly includePayouts: boolean;
  readonly includeRefunds: boolean;
  readonly includeDisputes: boolean;
  readonly dryRun: boolean;
  readonly assumeNonCharityAcknowledged: boolean;
  readonly created: StripeBackfillCreatedRange | null;
  readonly maxRecords: number | null;
  readonly logger?: Pick<Console, 'log' | 'warn'>;
}

export interface StripeBackfillSummary {
  readonly dryRun: boolean;
  readonly projectId: string;
  readonly includeUnmatched: boolean;
  readonly startedAt: string;
  finishedAt: string;
  checkoutSessions: {
    scanned: number;
    matched: number;
    skippedUnmatched: number;
    upserted: number;
    dryRunMatched: number;
  };
  paymentIntents: {
    seen: number;
    insertedTransactions: number;
    skippedExistingTransactions: number;
    missingBalanceTransactions: number;
    dryRunWouldInsertTransactions: number;
  };
  refunds: {
    seen: number;
    insertedTransactions: number;
    skippedExistingTransactions: number;
    dryRunWouldInsertTransactions: number;
  };
  payouts: {
    scanned: number;
    insertedTransactions: number;
    skippedExistingTransactions: number;
    dryRunWouldInsertTransactions: number;
  };
  disputes: {
    scanned: number;
    matched: number;
    statusUpdated: number;
    dryRunWouldUpdate: number;
  };
}

interface BackfillSchemaRow {
  readonly has_fund_transactions: boolean;
  readonly has_stripe_checkout_sessions: boolean;
  readonly has_fund_contributions: boolean;
  readonly has_public_reference: boolean;
  readonly has_followup_token_hash: boolean;
}

interface FundTransactionInput {
  readonly stripeEventId: string;
  readonly stripeObjectId: string;
  readonly stripeBalanceTransactionId: string | null;
  readonly type: string;
  readonly amount: number;
  readonly fee: number;
  readonly net: number;
  readonly currency: string;
  readonly status: string;
  readonly createdAtIso: string;
  readonly publicCategory: string;
  readonly metadataJson: Record<string, unknown>;
}

interface BackfillInsertResult {
  readonly inserted: boolean;
  readonly skippedExisting: boolean;
  readonly dryRunWouldInsert: boolean;
}

const contributionPublicReferencePattern = /^OG7-\d{4}-[A-Z0-9]{4,8}$/;

const toIsoFromUnix = (seconds: number): string =>
  new Date(seconds * 1000).toISOString();

const emptySummary = (
  options: StripeBackfillOptions
): StripeBackfillSummary => {
  const now = new Date().toISOString();

  return {
    dryRun: options.dryRun,
    projectId: options.projectId,
    includeUnmatched: options.includeUnmatched,
    startedAt: now,
    finishedAt: now,
    checkoutSessions: {
      scanned: 0,
      matched: 0,
      skippedUnmatched: 0,
      upserted: 0,
      dryRunMatched: 0
    },
    paymentIntents: {
      seen: 0,
      insertedTransactions: 0,
      skippedExistingTransactions: 0,
      missingBalanceTransactions: 0,
      dryRunWouldInsertTransactions: 0
    },
    refunds: {
      seen: 0,
      insertedTransactions: 0,
      skippedExistingTransactions: 0,
      dryRunWouldInsertTransactions: 0
    },
    payouts: {
      scanned: 0,
      insertedTransactions: 0,
      skippedExistingTransactions: 0,
      dryRunWouldInsertTransactions: 0
    },
    disputes: {
      scanned: 0,
      matched: 0,
      statusUpdated: 0,
      dryRunWouldUpdate: 0
    }
  };
};

const toMetadataRecord = (
  metadata: Stripe.Metadata | null | undefined
): Record<string, string> => ({ ...(metadata ?? {}) });

const metadataMatchesProject = (
  metadata: Stripe.Metadata | null | undefined,
  projectId: string
): boolean =>
  metadata?.projectId === projectId || metadata?.project === projectId;

const sessionMatchesProject = (
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent | null,
  projectId: string
): boolean =>
  metadataMatchesProject(session.metadata, projectId) ||
  metadataMatchesProject(paymentIntent?.metadata, projectId);

const parseMetadataBooleanWithFallback = (
  value: string | undefined,
  fallback: boolean
): boolean => (value === undefined ? fallback : parseMetadataBoolean(value));

const normalizePublicReference = (
  value: string | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  const reference = value.trim().toUpperCase();
  return contributionPublicReferencePattern.test(reference) ? reference : null;
};

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

const resolvePaymentIntentId = (
  value: string | Stripe.PaymentIntent | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.id;
};

const resolvePaymentIntent = async (
  stripe: Stripe,
  value: string | Stripe.PaymentIntent | null | undefined
): Promise<Stripe.PaymentIntent | null> => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return stripe.paymentIntents.retrieve(value, {
      expand: ['latest_charge.balance_transaction']
    });
  }

  return value;
};

const resolveCharge = async (
  stripe: Stripe,
  value: string | Stripe.Charge | null | undefined
): Promise<Stripe.Charge | null> => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return stripe.charges.retrieve(value, {
      expand: ['balance_transaction', 'payment_intent']
    });
  }

  return value;
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

const getLatestCharge = async (
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent
): Promise<Stripe.Charge | null> =>
  resolveCharge(stripe, paymentIntent.latest_charge);

const syntheticStripeEventId = (type: string, objectId: string): string =>
  `stripe-backfill:${type}:${objectId}`;

const assertBackfillSchema = async (pool: Pool): Promise<void> => {
  const result = await pool.query<BackfillSchemaRow>(`
    SELECT
      to_regclass('public.fund_transactions') IS NOT NULL AS has_fund_transactions,
      to_regclass('public.stripe_checkout_sessions') IS NOT NULL AS has_stripe_checkout_sessions,
      to_regclass('public.fund_contributions') IS NOT NULL AS has_fund_contributions,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fund_contributions'
          AND column_name = 'public_reference'
      ) AS has_public_reference,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fund_contributions'
          AND column_name = 'sponsorship_followup_token_hash'
      ) AS has_followup_token_hash
  `);

  const schema = result.rows[0];
  if (
    !schema?.has_fund_transactions ||
    !schema.has_stripe_checkout_sessions ||
    !schema.has_fund_contributions ||
    !schema.has_public_reference ||
    !schema.has_followup_token_hash
  ) {
    throw new Error(
      'PostgreSQL schema is missing funding tables or columns. Run `corepack yarn db:migrate` before Stripe backfill.'
    );
  }
};

const hasLogicalFundTransaction = async (
  pool: Pool,
  input: FundTransactionInput
): Promise<boolean> => {
  const result = await pool.query(
    `
      SELECT 1
      FROM fund_transactions
      WHERE type = $1
        AND stripe_object_id = $2
      LIMIT 1
    `,
    [input.type, input.stripeObjectId]
  );

  return (result.rowCount ?? 0) > 0;
};

const insertBackfilledFundTransaction = async (
  pool: Pool,
  input: FundTransactionInput,
  dryRun: boolean
): Promise<BackfillInsertResult> => {
  if (await hasLogicalFundTransaction(pool, input)) {
    return {
      inserted: false,
      skippedExisting: true,
      dryRunWouldInsert: false
    };
  }

  if (dryRun) {
    return {
      inserted: false,
      skippedExisting: false,
      dryRunWouldInsert: true
    };
  }

  const result = await pool.query(
    `
      INSERT INTO fund_transactions (
        stripe_event_id,
        stripe_object_id,
        stripe_balance_transaction_id,
        type,
        amount,
        fee,
        net,
        currency,
        status,
        created_at,
        public_category,
        metadata_json
      )
      SELECT
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb
      WHERE NOT EXISTS (
        SELECT 1
        FROM fund_transactions
        WHERE type = $4
          AND stripe_object_id = $2
      )
      ON CONFLICT (stripe_event_id) DO NOTHING
    `,
    [
      input.stripeEventId,
      input.stripeObjectId,
      input.stripeBalanceTransactionId,
      input.type,
      input.amount,
      input.fee,
      input.net,
      input.currency,
      input.status,
      input.createdAtIso,
      input.publicCategory,
      JSON.stringify(input.metadataJson)
    ]
  );

  return {
    inserted: result.rowCount === 1,
    skippedExisting: result.rowCount !== 1,
    dryRunWouldInsert: false
  };
};

const applyInsertResult = (
  target: {
    insertedTransactions: number;
    skippedExistingTransactions: number;
    dryRunWouldInsertTransactions: number;
  },
  result: BackfillInsertResult
): void => {
  if (result.inserted) {
    target.insertedTransactions += 1;
  }

  if (result.skippedExisting) {
    target.skippedExistingTransactions += 1;
  }

  if (result.dryRunWouldInsert) {
    target.dryRunWouldInsertTransactions += 1;
  }
};

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
    normalizePublicReference(metadata.publicReference) ??
    normalizePublicReference(session.client_reference_id) ??
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

  summary.refunds.seen += 1;

  if (!options.dryRun) {
    await updateContributionStatusByPaymentIntent(pool, {
      stripePaymentIntentId: paymentIntentId,
      status: 'refunded'
    });
  }

  const balanceData = buildBalanceData(
    await resolveBalanceTransaction(stripe, charge.balance_transaction),
    charge.amount_refunded,
    charge.currency
  );
  const insertResult = await insertBackfilledFundTransaction(
    pool,
    {
      stripeEventId: syntheticStripeEventId('charge.refunded', charge.id),
      stripeObjectId: charge.id,
      stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
      type: 'charge.refunded',
      amount: charge.amount_refunded,
      fee: balanceData.fee,
      net: balanceData.net,
      currency: balanceData.currency,
      status: charge.status,
      createdAtIso: toIsoFromUnix(charge.created),
      publicCategory: 'refund',
      metadataJson: {
        source: 'stripe_backfill',
        eventType: 'charge.refunded',
        paymentIntentId
      }
    },
    options.dryRun
  );

  applyInsertResult(summary.refunds, insertResult);
};

const shouldStopAfterScan = (
  scanned: number,
  maxRecords: number | null
): boolean => maxRecords !== null && scanned >= maxRecords;

const buildCheckoutSessionListParams = (
  options: StripeBackfillOptions
): Stripe.Checkout.SessionListParams => ({
  limit: 100,
  expand: ['data.payment_intent'],
  ...(options.created ? { created: options.created } : {})
});

const buildPayoutListParams = (
  options: StripeBackfillOptions
): Stripe.PayoutListParams => ({
  limit: 100,
  expand: ['data.balance_transaction'],
  ...(options.created ? { created: options.created } : {})
});

const buildDisputeListParams = (
  options: StripeBackfillOptions
): Stripe.DisputeListParams => ({
  limit: 100,
  expand: ['data.charge'],
  ...(options.created ? { created: options.created } : {})
});

const backfillCheckoutSessions = async (
  stripe: Stripe,
  pool: Pool,
  options: StripeBackfillOptions,
  summary: StripeBackfillSummary
): Promise<void> => {
  for await (const session of stripe.checkout.sessions.list(
    buildCheckoutSessionListParams(options)
  )) {
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
      sessionMatchesProject(session, paymentIntent, options.projectId);

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

const backfillPayouts = async (
  stripe: Stripe,
  pool: Pool,
  options: StripeBackfillOptions,
  summary: StripeBackfillSummary
): Promise<void> => {
  if (!options.includePayouts) {
    return;
  }

  for await (const payout of stripe.payouts.list(
    buildPayoutListParams(options)
  )) {
    if (shouldStopAfterScan(summary.payouts.scanned, options.maxRecords)) {
      break;
    }

    summary.payouts.scanned += 1;

    const type =
      payout.status === 'paid'
        ? 'payout.paid'
        : payout.status === 'failed'
          ? 'payout.failed'
          : null;

    if (!type) {
      continue;
    }

    const balanceData = buildBalanceData(
      await resolveBalanceTransaction(stripe, payout.balance_transaction),
      payout.amount,
      payout.currency
    );
    const insertResult = await insertBackfilledFundTransaction(
      pool,
      {
        stripeEventId: syntheticStripeEventId(type, payout.id),
        stripeObjectId: payout.id,
        stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
        type,
        amount: payout.amount,
        fee: balanceData.fee,
        net: balanceData.net,
        currency: balanceData.currency,
        status: payout.status,
        createdAtIso: toIsoFromUnix(payout.created),
        publicCategory: 'payout',
        metadataJson: {
          source: 'stripe_backfill',
          eventType: type
        }
      },
      options.dryRun
    );

    applyInsertResult(summary.payouts, insertResult);
  }
};

const resolveDisputePaymentIntent = async (
  stripe: Stripe,
  dispute: Stripe.Dispute
): Promise<Stripe.PaymentIntent | null> => {
  const charge = await resolveCharge(stripe, dispute.charge);
  return resolvePaymentIntent(stripe, charge?.payment_intent);
};

const backfillDisputes = async (
  stripe: Stripe,
  pool: Pool,
  options: StripeBackfillOptions,
  summary: StripeBackfillSummary
): Promise<void> => {
  if (!options.includeDisputes) {
    return;
  }

  for await (const dispute of stripe.disputes.list(
    buildDisputeListParams(options)
  )) {
    if (shouldStopAfterScan(summary.disputes.scanned, options.maxRecords)) {
      break;
    }

    summary.disputes.scanned += 1;

    const paymentIntent = await resolveDisputePaymentIntent(stripe, dispute);
    if (!paymentIntent) {
      continue;
    }

    const matches =
      options.includeUnmatched ||
      metadataMatchesProject(paymentIntent.metadata, options.projectId);

    if (!matches) {
      continue;
    }

    summary.disputes.matched += 1;

    if (options.dryRun) {
      summary.disputes.dryRunWouldUpdate += 1;
      continue;
    }

    const updated = await updateContributionStatusByPaymentIntent(pool, {
      stripePaymentIntentId: paymentIntent.id,
      status: 'disputed'
    });

    if (updated) {
      summary.disputes.statusUpdated += 1;
    }
  }
};

export const runStripeBackfill = async (
  stripe: Stripe,
  pool: Pool,
  options: StripeBackfillOptions
): Promise<StripeBackfillSummary> => {
  await assertBackfillSchema(pool);

  const summary = emptySummary(options);
  options.logger?.log(
    `Stripe backfill started for project ${options.projectId}${options.dryRun ? ' (dry run)' : ''}.`
  );

  await backfillCheckoutSessions(stripe, pool, options, summary);
  await backfillPayouts(stripe, pool, options, summary);
  await backfillDisputes(stripe, pool, options, summary);

  summary.finishedAt = new Date().toISOString();
  options.logger?.log('Stripe backfill completed.');

  return summary;
};
