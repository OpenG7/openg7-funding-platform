import type { ContributionType } from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { projectStoredCheckoutMetadata } from './stripe-event-projection.js';
import { allowedPreviousPaymentStatuses } from './contribution-payment-state.js';
import { recordContributionActivity } from './contribution-activity.repository.js';
import { activateSponsorshipCommitments } from './sponsorship-commitments.repository.js';

export interface CheckoutSessionRecordInput {
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly publicReference: string | null;
  readonly contributionType: ContributionType;
  readonly amountCents: number;
  readonly currency: string;
  readonly metadata: Record<string, string>;
  readonly publicDisplayConsent: boolean;
  readonly publicName: string | null;
  readonly displayAmountConsent: boolean;
  readonly nonCharityAcknowledged: boolean;
  readonly sponsorshipFollowupTokenHash: string | null;
}

export interface CheckoutSessionWebhookInput extends CheckoutSessionRecordInput {
  readonly notifyAdmin?: boolean;
  /** Monetary facts from a paid provider object, never inferred from local status. */
  readonly trustedPaymentFacts?: {
    readonly amountCents: number;
    readonly currency: string;
    readonly publicReference?: string | null;
  };
  readonly status: 'pending' | 'paid' | 'expired' | 'failed';
  readonly paidAtIso: string | null;
  readonly emailPrivate: string | null;
}

export interface PaymentIntentStatusInput {
  readonly checkoutMatch?: {
    readonly publicReference: string;
    readonly amountCents: number;
    readonly currency: string;
  };
  readonly notifyAdmin?: boolean;
  readonly stripePaymentIntentId: string;
  readonly status: 'paid' | 'failed' | 'refunded' | 'disputed';
  readonly paidAtIso?: string | null;
}

const readPaymentJournal = async (
  client: PoolClient,
  paymentIntentId: string | null
) => {
  if (!paymentIntentId)
    return { journalPresent: false, trustedPaymentFacts: undefined };
  const payments = await client.query<{ amount: string; currency: string }>(
    `SELECT amount::text,currency FROM fund_transactions
     WHERE stripe_object_id=$1 AND type='payment_intent.succeeded'
       AND status='succeeded' AND public_category='contribution'`,
    [paymentIntentId]
  );
  const first = payments.rows[0];
  const amountCents = Number(first?.amount);
  const trustworthy =
    first &&
    Number.isSafeInteger(amountCents) &&
    amountCents > 0 &&
    payments.rows.every(
      (row) =>
        row.amount === first.amount &&
        row.currency.toUpperCase() === first.currency.toUpperCase()
    );
  return {
    journalPresent: payments.rows.length > 0,
    trustedPaymentFacts: trustworthy
      ? { amountCents, currency: first.currency }
      : undefined
  };
};

const readPaymentConfirmation = async (
  client: PoolClient,
  paymentIntentId: string | null
) => {
  if (!paymentIntentId) return null;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    'payment-confirmation:' + paymentIntentId
  ]);
  const proof = await client.query<{ paid_at: Date }>(
    'SELECT paid_at FROM contribution_payment_confirmations WHERE payment_intent_id=$1',
    [paymentIntentId]
  );
  if (!proof.rows[0]) return null;
  // The marker confirms timing, not monetary terms. A silent backfill can also
  // retain a journal without this marker; neither path may infer its price.
  return {
    paidAtIso: proof.rows[0].paid_at.toISOString(),
    ...(await readPaymentJournal(client, paymentIntentId))
  };
};

export const insertCheckoutSessionRecord = async (
  pool: Pool | PoolClient | null,
  input: CheckoutSessionRecordInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const ownsClient = !('release' in pool);
  const client: PoolClient = 'release' in pool ? pool : await pool.connect();
  try {
    await client.query('BEGIN');

    const confirmation = await readPaymentConfirmation(
      client,
      input.stripePaymentIntentId
    );

    const sessionResult = await client.query(
      `
        INSERT INTO stripe_checkout_sessions (
          stripe_session_id,
          stripe_payment_intent_id,
          contribution_type,
          amount_cents,
          currency,
          metadata,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')
        ON CONFLICT (stripe_session_id) DO NOTHING
      `,
      [
        input.stripeSessionId,
        input.stripePaymentIntentId,
        input.contributionType,
        input.amountCents,
        input.currency.toLowerCase(),
        JSON.stringify(projectStoredCheckoutMetadata(input.metadata))
      ]
    );

    await client.query(
      `
        INSERT INTO fund_contributions (
          public_reference,
          contribution_type,
          amount_cents,
          currency,
          public_display_consent,
          public_name,
          display_amount_consent,
          non_charity_acknowledged,
          stripe_session_id,
          stripe_payment_intent_id,
          status,
          sponsorship_followup_token_hash,
          sponsorship_followup_token_created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11,
          CASE WHEN $11::text IS NULL THEN NULL ELSE NOW() END
        )
        ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL
        DO NOTHING
      `,
      [
        input.publicReference,
        input.contributionType,
        input.amountCents,
        input.currency.toLowerCase(),
        input.publicDisplayConsent,
        input.publicName,
        input.displayAmountConsent,
        input.nonCharityAcknowledged,
        input.stripeSessionId,
        input.stripePaymentIntentId,
        input.sponsorshipFollowupTokenHash
      ]
    );

    if (confirmation) {
      // A genuine success received before the local pending row must converge
      // here too, while terminal financial states and local choices survive.
      await client.query(
        `UPDATE stripe_checkout_sessions SET status='paid',updated_at=NOW()
         WHERE stripe_session_id=$1 AND status=ANY($2::text[])`,
        [input.stripeSessionId, allowedPreviousPaymentStatuses('paid')]
      );
      await client.query(
        `UPDATE fund_contributions SET status='paid',
           paid_at=COALESCE(paid_at,$2::timestamptz),updated_at=NOW()
         WHERE stripe_session_id=$1 AND status=ANY($3::text[])`,
        [
          input.stripeSessionId,
          confirmation.paidAtIso,
          allowedPreviousPaymentStatuses('paid')
        ]
      );
      await activateSponsorshipCommitments(client, {
        stripeSessionId: input.stripeSessionId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        trustedPaymentFacts: confirmation.trustedPaymentFacts
      });
      await recordContributionActivity(
        client,
        input.stripeSessionId,
        input.stripePaymentIntentId,
        true
      );
    }
    await client.query('COMMIT');
    return sessionResult.rowCount === 1;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
};

export const upsertCheckoutSessionFromWebhook = async (
  pool: Pool | null,
  input: CheckoutSessionWebhookInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const confirmation = await readPaymentConfirmation(
      client,
      input.stripePaymentIntentId
    );
    const journal =
      confirmation ??
      (await readPaymentJournal(client, input.stripePaymentIntentId));
    const trustedPaymentFacts = journal.journalPresent
      ? journal.trustedPaymentFacts
      : input.status === 'paid'
        ? input.trustedPaymentFacts
        : undefined;
    if (confirmation) {
      input = {
        ...input,
        status: 'paid',
        paidAtIso: confirmation.paidAtIso
      };
    }

    await client.query(
      `
        INSERT INTO stripe_checkout_sessions (
          stripe_session_id,
          stripe_payment_intent_id,
          contribution_type,
          amount_cents,
          currency,
          metadata,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        ON CONFLICT (stripe_session_id) DO UPDATE
        SET
          stripe_payment_intent_id = COALESCE(
            stripe_checkout_sessions.stripe_payment_intent_id,
            EXCLUDED.stripe_payment_intent_id
          ),
          metadata = stripe_checkout_sessions.metadata || EXCLUDED.metadata,
          status = CASE
            WHEN stripe_checkout_sessions.status = ANY($8::text[])
            THEN EXCLUDED.status
            ELSE stripe_checkout_sessions.status
          END,
          updated_at = NOW()
      `,
      [
        input.stripeSessionId,
        input.stripePaymentIntentId,
        input.contributionType,
        input.amountCents,
        input.currency.toLowerCase(),
        JSON.stringify(projectStoredCheckoutMetadata(input.metadata)),
        input.status,
        allowedPreviousPaymentStatuses(input.status)
      ]
    );

    const result = await client.query(
      `
        INSERT INTO fund_contributions (
          public_reference,
          contribution_type,
          amount_cents,
          currency,
          email_private,
          public_display_consent,
          public_name,
          display_amount_consent,
          non_charity_acknowledged,
          stripe_session_id,
          stripe_payment_intent_id,
          status,
          paid_at,
          sponsorship_followup_token_hash,
          sponsorship_followup_token_created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13::timestamptz, $14,
          CASE WHEN $14::text IS NULL THEN NULL ELSE NOW() END
        )
        ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL
        DO UPDATE
        SET
          stripe_payment_intent_id = COALESCE(
            fund_contributions.stripe_payment_intent_id,
            EXCLUDED.stripe_payment_intent_id
          ),
          public_reference = COALESCE(
            fund_contributions.public_reference,
            EXCLUDED.public_reference
          ),
          email_private = COALESCE(
            fund_contributions.email_private,
            EXCLUDED.email_private
          ),
          -- Provider metadata initializes new rows. Replays must preserve local choices.
          status = CASE
            WHEN fund_contributions.status = ANY($15::text[])
            THEN EXCLUDED.status
            ELSE fund_contributions.status
          END,
          paid_at = COALESCE(fund_contributions.paid_at, EXCLUDED.paid_at),
          sponsorship_followup_token_hash = COALESCE(
            fund_contributions.sponsorship_followup_token_hash,
            EXCLUDED.sponsorship_followup_token_hash
          ),
          sponsorship_followup_token_created_at = COALESCE(
            fund_contributions.sponsorship_followup_token_created_at,
            EXCLUDED.sponsorship_followup_token_created_at
          ),
          updated_at = NOW()
      `,
      [
        input.publicReference,
        input.contributionType,
        input.amountCents,
        input.currency.toLowerCase(),
        input.emailPrivate,
        input.publicDisplayConsent,
        input.publicName,
        input.displayAmountConsent,
        input.nonCharityAcknowledged,
        input.stripeSessionId,
        input.stripePaymentIntentId,
        input.status,
        input.paidAtIso,
        input.sponsorshipFollowupTokenHash,
        allowedPreviousPaymentStatuses(input.status)
      ]
    );

    await activateSponsorshipCommitments(client, {
      stripeSessionId: input.stripeSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      trustedPaymentFacts
    });
    await recordContributionActivity(
      client,
      input.stripeSessionId,
      input.stripePaymentIntentId,
      input.notifyAdmin === true
    );
    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const updateContributionStatusByPaymentIntent = async (
  pool: Pool | null,
  input: PaymentIntentStatusInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'payment-confirmation:' + input.stripePaymentIntentId
    ]);
    // Checkout may not have a PaymentIntent when created. Only trusted webhook
    // metadata plus matching financial facts can attach the first intent.
    if (input.checkoutMatch) {
      const linked = await client.query<{ stripe_session_id: string }>(
        `UPDATE fund_contributions SET stripe_payment_intent_id = $1
         WHERE public_reference = $2 AND amount_cents = $3 AND currency = $4
           AND stripe_payment_intent_id IS NULL AND stripe_session_id IS NOT NULL
           AND status = ANY($5::text[])
         RETURNING stripe_session_id`,
        [
          input.stripePaymentIntentId,
          input.checkoutMatch.publicReference,
          input.checkoutMatch.amountCents,
          input.checkoutMatch.currency.toLowerCase(),
          allowedPreviousPaymentStatuses(input.status)
        ]
      );
      for (const row of linked.rows) {
        await client.query(
          `UPDATE stripe_checkout_sessions SET stripe_payment_intent_id = $1
           WHERE stripe_session_id = $2 AND stripe_payment_intent_id IS NULL`,
          [input.stripePaymentIntentId, row.stripe_session_id]
        );
      }
    }
    if (input.status === 'paid' && input.notifyAdmin) {
      await client.query(
        `INSERT INTO contribution_payment_confirmations(payment_intent_id,paid_at) VALUES($1,COALESCE($2,NOW())) ON CONFLICT DO NOTHING`,
        [input.stripePaymentIntentId, input.paidAtIso ?? null]
      );
    }

    await client.query(
      `
        UPDATE stripe_checkout_sessions
        SET
          status = $2,
          updated_at = NOW()
        WHERE stripe_payment_intent_id = $1
          AND status = ANY($3::text[])
      `,
      [
        input.stripePaymentIntentId,
        input.status,
        allowedPreviousPaymentStatuses(input.status)
      ]
    );

    const result = await client.query(
      `
        UPDATE fund_contributions
        SET
          status = $2,
          paid_at = CASE
            WHEN $2 = 'paid' THEN COALESCE(paid_at, $3::timestamptz)
            ELSE paid_at
          END,
          updated_at = NOW()
        WHERE stripe_payment_intent_id = $1
          AND status = ANY($4::text[])
      `,
      [
        input.stripePaymentIntentId,
        input.status,
        input.paidAtIso ?? null,
        allowedPreviousPaymentStatuses(input.status)
      ]
    );

    if (input.status === 'paid') {
      // Payment status can arrive before its journal. Preserve ambiguity here;
      // the financial handler qualifies terms only after monetary facts commit.
      await activateSponsorshipCommitments(client, {
        stripePaymentIntentId: input.stripePaymentIntentId
      });
      await recordContributionActivity(
        client,
        null,
        input.stripePaymentIntentId,
        input.notifyAdmin === true
      );
    }
    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
