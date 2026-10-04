import type { Pool } from 'pg';
import type {
  AdminSponsorshipInvoiceBackfillError,
  AdminSponsorshipInvoiceBackfillResult,
  AdminSponsorshipInvoiceRecord
} from '@openg7/funding-core';

import { parseDbInt } from '../sponsorship-invoice.mapping.js';

import { getAdminSponsorshipInvoiceById } from './invoices.read.js';
import { createSponsorshipInvoiceForStripeSession } from './invoices.write.js';

interface SponsorshipInvoiceBackfillCountRow {
  readonly eligible_count: string;
  readonly missing_count: string;
}

interface SponsorshipInvoiceBackfillCandidateRow {
  readonly id: string;
  readonly public_reference: string | null;
  readonly stripe_session_id: string;
  readonly stripe_payment_intent_id: string | null;
  readonly amount_cents: string;
  readonly currency: string;
  readonly paid_at: string | null;
  readonly email_private: string | null;
}

const normalizeBackfillLimit = (value: number | undefined): number =>
  Number.isInteger(value) && value !== undefined
    ? Math.max(1, Math.min(value, 1000))
    : 250;

const errorMessageFromUnknown = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown sponsorship invoice error.';

export const backfillMissingSponsorshipInvoices = async (
  pool: Pool | null,
  input: { readonly limit?: number; readonly contributionId?: string } = {}
): Promise<AdminSponsorshipInvoiceBackfillResult> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      data_source: 'database',
      eligible_count: 0,
      missing_count: 0,
      processed_count: 0,
      created_count: 0,
      skipped_count: 0,
      remaining_count: 0,
      failed_count: 0,
      invoiceIds: [],
      invoices: [],
      errors: [],
      last_updated_at: now
    };
  }

  const limit = normalizeBackfillLimit(input.limit);
  const countResult = await pool.query<SponsorshipInvoiceBackfillCountRow>(
    `
    SELECT
      COUNT(contribution.id)::text AS eligible_count,
      COALESCE(
        SUM(CASE WHEN invoice.id IS NULL THEN 1 ELSE 0 END),
        0
      )::text AS missing_count
    FROM fund_contributions contribution
    LEFT JOIN sponsorship_invoices invoice
      ON invoice.contribution_id = contribution.id
    WHERE contribution.contribution_type = 'sponsorship_interest'
      AND contribution.status IN ('paid', 'refunded', 'disputed')
      AND contribution.stripe_session_id IS NOT NULL
      AND ($1::text IS NULL OR contribution.id::text = $1)
  `,
    [input.contributionId ?? null]
  );
  const counts = countResult.rows[0];
  const eligibleCount = parseDbInt(counts?.eligible_count ?? '0');
  const missingCount = parseDbInt(counts?.missing_count ?? '0');

  const candidateResult =
    await pool.query<SponsorshipInvoiceBackfillCandidateRow>(
      `
        SELECT
          contribution.id::text AS id,
          contribution.public_reference,
          contribution.stripe_session_id,
          contribution.stripe_payment_intent_id,
          contribution.amount_cents::text AS amount_cents,
          contribution.currency,
          contribution.paid_at::text AS paid_at,
          contribution.email_private
        FROM fund_contributions contribution
        LEFT JOIN sponsorship_invoices invoice
          ON invoice.contribution_id = contribution.id
        WHERE contribution.contribution_type = 'sponsorship_interest'
          AND contribution.status IN ('paid', 'refunded', 'disputed')
          AND contribution.stripe_session_id IS NOT NULL
          AND invoice.id IS NULL
          AND ($2::text IS NULL OR contribution.id::text = $2)
        ORDER BY
          COALESCE(
            contribution.paid_at,
            contribution.updated_at,
            contribution.created_at
          ) ASC
        LIMIT $1
      `,
      [limit, input.contributionId ?? null]
    );

  const invoiceIds: string[] = [];
  const errors: AdminSponsorshipInvoiceBackfillError[] = [];

  for (const candidate of candidateResult.rows) {
    try {
      const invoice = await createSponsorshipInvoiceForStripeSession(pool, {
        stripeSessionId: candidate.stripe_session_id,
        stripePaymentIntentId: candidate.stripe_payment_intent_id,
        publicReference: candidate.public_reference,
        amountCents: parseDbInt(candidate.amount_cents),
        currency: candidate.currency,
        paidAtIso: candidate.paid_at,
        customerEmail: candidate.email_private
      });

      if (invoice) {
        invoiceIds.push(invoice.id);
      } else {
        errors.push({
          contribution_id: candidate.id,
          stripe_session_id: candidate.stripe_session_id,
          error: 'No sponsorship invoice was created.'
        });
      }
    } catch (error) {
      errors.push({
        contribution_id: candidate.id,
        stripe_session_id: candidate.stripe_session_id,
        error: errorMessageFromUnknown(error)
      });
    }
  }

  const invoices = (
    await Promise.all(
      invoiceIds.map((invoiceId) =>
        getAdminSponsorshipInvoiceById(pool, invoiceId)
      )
    )
  ).filter(
    (invoice): invoice is AdminSponsorshipInvoiceRecord => invoice !== null
  );
  const processedCount = candidateResult.rows.length;

  return {
    data_source: 'database',
    eligible_count: eligibleCount,
    missing_count: missingCount,
    processed_count: processedCount,
    created_count: invoiceIds.length,
    skipped_count: Math.max(0, eligibleCount - missingCount),
    remaining_count: Math.max(0, missingCount - processedCount),
    failed_count: errors.length,
    invoiceIds,
    invoices,
    errors,
    last_updated_at: new Date().toISOString()
  };
};
