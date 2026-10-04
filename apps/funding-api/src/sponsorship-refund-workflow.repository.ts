import type {
  AdminSponsorshipStripeRefundReason,
  AdminSponsorshipRefundWorkflowStatus
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  centsToAmount,
  parseDbInt
} from './contributions-persistence-helpers.js';
import { normalizeSponsorshipRefundWorkflowStatus } from './sponsorship-persistence-helpers.js';
export interface SponsorshipRefundTarget {
  readonly id: string;
  readonly version: string;
  readonly publicReference: string | null;
  readonly paymentStatus: string;
  readonly refundWorkflowStatus: AdminSponsorshipRefundWorkflowStatus;
  readonly refundId: string | null;
  readonly amountCents: number;
  readonly amount: number;
  readonly currency: string;
  readonly stripePaymentIntentId: string | null;
  readonly sponsorName: string;
}

export interface SponsorshipRefundWorkflowUpdateInput {
  readonly contributionId: string;
  readonly refundStatus: AdminSponsorshipRefundWorkflowStatus;
  readonly refundId?: string | null;
  readonly refundAmountCents?: number | null;
  readonly refundReason?: AdminSponsorshipStripeRefundReason | null;
  readonly refundNote?: string | null;
  readonly refundError?: string | null;
}

export interface SponsorshipRefundWorkflowUpdateByPaymentIntentInput {
  readonly stripePaymentIntentId: string;
  readonly refundStatus: AdminSponsorshipRefundWorkflowStatus;
  readonly refundId?: string | null;
  readonly refundAmountCents?: number | null;
  readonly refundReason?: AdminSponsorshipStripeRefundReason | null;
  readonly refundNote?: string | null;
  readonly refundError?: string | null;
}

export const getSponsorshipRefundTarget = async (
  pool: Pool | null,
  contributionId: string
): Promise<SponsorshipRefundTarget | null> => {
  if (!pool) {
    return null;
  }

  const query = await pool.query<{
    readonly id: string;
    readonly version: string;
    readonly public_reference: string | null;
    readonly payment_status: string;
    readonly sponsorship_refund_status: AdminSponsorshipRefundWorkflowStatus | null;
    readonly sponsorship_refund_id: string | null;
    readonly amount_cents: string;
    readonly currency: string;
    readonly stripe_payment_intent_id: string | null;
    readonly sponsor_name: string | null;
  }>(
    `
      SELECT
        id::text AS id,
        updated_at::text AS version,
        public_reference,
        status AS payment_status,
        COALESCE(sponsorship_refund_status, 'not_requested') AS sponsorship_refund_status,
        sponsorship_refund_id,
        amount_cents::text AS amount_cents,
        currency,
        stripe_payment_intent_id,
        COALESCE(
          NULLIF(btrim(sponsor_company_name), ''),
          NULLIF(btrim(public_name), ''),
          public_reference,
          'Commanditaire'
        ) AS sponsor_name
      FROM fund_contributions
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
      LIMIT 1
    `,
    [contributionId]
  );

  const row = query.rows[0];
  if (!row) {
    return null;
  }

  const amountCents = parseDbInt(row.amount_cents);
  return {
    id: row.id,
    version: row.version,
    publicReference: row.public_reference,
    paymentStatus: row.payment_status,
    refundWorkflowStatus: normalizeSponsorshipRefundWorkflowStatus(
      row.sponsorship_refund_status,
      row.payment_status
    ),
    refundId: row.sponsorship_refund_id,
    amountCents,
    amount: centsToAmount(amountCents),
    currency: row.currency.toUpperCase(),
    stripePaymentIntentId: row.stripe_payment_intent_id,
    sponsorName: row.sponsor_name ?? 'Commanditaire'
  };
};

export const updateSponsorshipRefundWorkflowStatus = async (
  pool: Pool | PoolClient | null,
  input: SponsorshipRefundWorkflowUpdateInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `
      UPDATE fund_contributions
      SET
        sponsorship_refund_status = $2,
        sponsorship_refund_requested_at = CASE
          WHEN $2 IN ('requested', 'processing') THEN NOW()
          WHEN $2 IN ('completed', 'failed')
          THEN COALESCE(sponsorship_refund_requested_at, NOW())
          ELSE sponsorship_refund_requested_at
        END,
        sponsorship_refund_processed_at = CASE
          WHEN $2 = 'processing' THEN NOW()
          WHEN $2 IN ('completed', 'failed')
          THEN COALESCE(sponsorship_refund_processed_at, NOW())
          ELSE sponsorship_refund_processed_at
        END,
        sponsorship_refund_completed_at = CASE
          WHEN $2 = 'completed' THEN NOW()
          WHEN $2 IN ('requested', 'processing', 'failed') THEN NULL
          ELSE sponsorship_refund_completed_at
        END,
        sponsorship_refund_id = COALESCE($3, sponsorship_refund_id),
        sponsorship_refund_amount_cents = COALESCE($6, sponsorship_refund_amount_cents),
        sponsorship_refund_reason = COALESCE($7, sponsorship_refund_reason),
        sponsorship_refund_note = COALESCE(NULLIF($4, ''), sponsorship_refund_note),
        sponsorship_refund_error = CASE
          WHEN $2 = 'failed' THEN $5
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
    `,
    [
      input.contributionId,
      input.refundStatus,
      input.refundId ?? null,
      input.refundNote ?? null,
      input.refundError ?? null,
      input.refundAmountCents ?? null,
      input.refundReason ?? null
    ]
  );

  return (result.rowCount ?? 0) > 0;
};

export const updateSponsorshipRefundWorkflowStatusByPaymentIntent = async (
  pool: Pool | null,
  input: SponsorshipRefundWorkflowUpdateByPaymentIntentInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `
      UPDATE fund_contributions
      SET
        sponsorship_refund_status = $2,
        sponsorship_refund_requested_at = CASE
          WHEN $2 IN ('requested', 'processing') THEN NOW()
          WHEN $2 IN ('completed', 'failed')
          THEN COALESCE(sponsorship_refund_requested_at, NOW())
          ELSE sponsorship_refund_requested_at
        END,
        sponsorship_refund_processed_at = CASE
          WHEN $2 = 'processing' THEN NOW()
          WHEN $2 IN ('completed', 'failed')
          THEN COALESCE(sponsorship_refund_processed_at, NOW())
          ELSE sponsorship_refund_processed_at
        END,
        sponsorship_refund_completed_at = CASE
          WHEN $2 = 'completed' THEN NOW()
          WHEN $2 IN ('requested', 'processing', 'failed') THEN NULL
          ELSE sponsorship_refund_completed_at
        END,
        sponsorship_refund_id = COALESCE($3, sponsorship_refund_id),
        sponsorship_refund_amount_cents = COALESCE($6, sponsorship_refund_amount_cents),
        sponsorship_refund_reason = COALESCE($7, sponsorship_refund_reason),
        sponsorship_refund_note = COALESCE(NULLIF($4, ''), sponsorship_refund_note),
        sponsorship_refund_error = CASE
          WHEN $2 = 'failed' THEN $5
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE stripe_payment_intent_id = $1
        AND contribution_type = 'sponsorship_interest'
    `,
    [
      input.stripePaymentIntentId,
      input.refundStatus,
      input.refundId ?? null,
      input.refundNote ?? null,
      input.refundError ?? null,
      input.refundAmountCents ?? null,
      input.refundReason ?? null
    ]
  );

  return (result.rowCount ?? 0) > 0;
};
