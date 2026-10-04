import type { Pool } from 'pg';

import { insertFundTransaction } from '../fund-transparency.repository.js';

import type {
  BackfillInsertResult,
  FundTransactionInput
} from './contracts.js';

interface BackfillSchemaRow {
  readonly has_fund_transactions: boolean;
  readonly has_stripe_checkout_sessions: boolean;
  readonly has_fund_contributions: boolean;
  readonly has_public_reference: boolean;
  readonly has_followup_token_hash: boolean;
}

export const assertBackfillSchema = async (pool: Pool): Promise<void> => {
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

export const insertBackfilledFundTransaction = async (
  pool: Pool,
  input: FundTransactionInput,
  dryRun: boolean
): Promise<BackfillInsertResult> => {
  if (
    !dryRun &&
    ['payment_intent.succeeded', 'payout.paid', 'payout.failed'].includes(
      input.type
    )
  ) {
    const inserted = await insertFundTransaction(pool, input);
    return { inserted, skippedExisting: !inserted, dryRunWouldInsert: false };
  }
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
