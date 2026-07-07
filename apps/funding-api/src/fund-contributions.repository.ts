import type { ContributionType } from '@openg7/funding-core';
import type { Pool } from 'pg';

export interface CheckoutSessionRecordInput {
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly contributionType: ContributionType;
  readonly amountCents: number;
  readonly currency: string;
  readonly metadata: Record<string, string>;
  readonly publicDisplayConsent: boolean;
  readonly displayAmountConsent: boolean;
  readonly nonCharityAcknowledged: boolean;
}

export const insertCheckoutSessionRecord = async (
  pool: Pool | null,
  input: CheckoutSessionRecordInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
        JSON.stringify(input.metadata)
      ]
    );

    await client.query(
      `
        INSERT INTO fund_contributions (
          contribution_type,
          amount_cents,
          currency,
          public_display_consent,
          display_amount_consent,
          non_charity_acknowledged,
          stripe_session_id,
          stripe_payment_intent_id,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
        ON CONFLICT (stripe_session_id) DO NOTHING
      `,
      [
        input.contributionType,
        input.amountCents,
        input.currency.toLowerCase(),
        input.publicDisplayConsent,
        input.displayAmountConsent,
        input.nonCharityAcknowledged,
        input.stripeSessionId,
        input.stripePaymentIntentId
      ]
    );

    await client.query('COMMIT');
    return sessionResult.rowCount === 1;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
