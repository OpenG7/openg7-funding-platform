import type { Pool } from 'pg';
import type {
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipInvoicesSummary
} from '@openg7/funding-core';

import {
  centsToAmount,
  mapAdminSponsorshipInvoiceRow,
  mapSponsorshipInvoiceRow,
  parseDbInt,
  type AdminSponsorshipInvoiceRow,
  type SponsorshipInvoiceRecord,
  type SponsorshipInvoiceRow
} from '../sponsorship-invoice.mapping.js';

import { listAdminSponsorshipCreditNotesForInvoices } from './credit-notes.repository.js';
import { latestEmailSelect, sponsorshipInvoiceSelect } from './queries.js';

interface AdminSponsorshipInvoiceSummaryRow {
  readonly total_count: string;
  readonly total_amount: string;
  readonly credit_note_count: string;
  readonly total_credited: string;
  readonly failed_email_count: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

const latestInvoiceEmailJoin = `
  LEFT JOIN LATERAL (
    SELECT status, recipient_email, sent_at, last_error
    FROM email_messages
    WHERE template_key = 'sponsorship_invoice'
      AND metadata->>'invoiceId' = invoice.id::text
    ORDER BY created_at DESC
    LIMIT 1
  ) latest_email ON TRUE
`;

export const getSponsorshipInvoiceById = async (
  pool: Pool | null,
  invoiceId: string
): Promise<SponsorshipInvoiceRecord | null> => {
  if (!pool) {
    return null;
  }

  const result = await pool.query<SponsorshipInvoiceRow>(
    `
      SELECT ${sponsorshipInvoiceSelect}
      FROM sponsorship_invoices invoice
      WHERE invoice.id = $1::uuid
      LIMIT 1
    `,
    [invoiceId]
  );

  return result.rows[0] ? mapSponsorshipInvoiceRow(result.rows[0]) : null;
};

export const getAdminSponsorshipInvoiceById = async (
  pool: Pool | null,
  invoiceId: string
): Promise<AdminSponsorshipInvoiceRecord | null> => {
  if (!pool) {
    return null;
  }

  const result = await pool.query<AdminSponsorshipInvoiceRow>(
    `
      SELECT ${sponsorshipInvoiceSelect}, ${latestEmailSelect}
      FROM sponsorship_invoices invoice
      ${latestInvoiceEmailJoin}
      WHERE invoice.id = $1::uuid
      LIMIT 1
    `,
    [invoiceId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const creditNotes = await listAdminSponsorshipCreditNotesForInvoices(pool, [
    invoiceId
  ]);
  return mapAdminSponsorshipInvoiceRow(row, creditNotes.get(invoiceId) ?? []);
};

export const listAdminSponsorshipInvoices = async (
  pool: Pool | null,
  contributionId?: string
): Promise<AdminSponsorshipInvoicesResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      data_source: 'database',
      invoices: [],
      summary: {
        total_count: 0,
        total_amount: 0,
        credit_note_count: 0,
        total_credited: 0,
        failed_email_count: 0,
        currency: 'CAD'
      },
      last_updated_at: now
    };
  }

  const [invoiceResult, summaryResult] = await Promise.all([
    pool.query<AdminSponsorshipInvoiceRow>(
      `
        SELECT ${sponsorshipInvoiceSelect}, ${latestEmailSelect}
        FROM sponsorship_invoices invoice
        ${latestInvoiceEmailJoin}
        WHERE ($1::text IS NULL OR invoice.contribution_id::text = $1)
        ORDER BY invoice.issued_at DESC, invoice.created_at DESC
        LIMIT 250
      `,
      [contributionId ?? null]
    ),
    pool.query<AdminSponsorshipInvoiceSummaryRow>(
      `
        WITH latest_email AS (
          SELECT DISTINCT ON (metadata->>'invoiceId')
            metadata->>'invoiceId' AS invoice_id,
            status
          FROM email_messages
          WHERE template_key = 'sponsorship_invoice'
            AND metadata->>'invoiceId' IS NOT NULL
          ORDER BY metadata->>'invoiceId', created_at DESC
        ),
        latest_credit_note_email AS (
          SELECT DISTINCT ON (metadata->>'creditNoteId')
            metadata->>'creditNoteId' AS credit_note_id,
            status
          FROM email_messages
          WHERE template_key = 'sponsorship_credit_note'
            AND metadata->>'creditNoteId' IS NOT NULL
          ORDER BY metadata->>'creditNoteId', created_at DESC
        ),
        invoice_totals AS (
          SELECT
            COUNT(invoice.id)::text AS total_count,
            COALESCE(SUM(invoice.total_cents), 0)::text AS total_amount,
            COALESCE(
              SUM(CASE WHEN latest_email.status = 'failed' THEN 1 ELSE 0 END),
              0
            )::int AS failed_invoice_email_count,
            COALESCE(MAX(invoice.currency), 'cad') AS currency,
            COALESCE(MAX(invoice.updated_at), NOW()) AS invoice_last_updated_at
          FROM sponsorship_invoices invoice
          LEFT JOIN latest_email ON latest_email.invoice_id = invoice.id::text
        ),
        credit_note_totals AS (
          SELECT
            COUNT(credit_note.id)::text AS credit_note_count,
            COALESCE(SUM(credit_note.total_cents), 0)::text AS total_credited,
            COALESCE(
              SUM(
                CASE
                  WHEN latest_credit_note_email.status = 'failed' THEN 1
                  ELSE 0
                END
              ),
              0
            )::int AS failed_credit_note_email_count,
            MAX(credit_note.updated_at) AS credit_note_last_updated_at
          FROM sponsorship_credit_notes credit_note
          LEFT JOIN latest_credit_note_email
            ON latest_credit_note_email.credit_note_id = credit_note.id::text
        )
        SELECT
          invoice_totals.total_count,
          invoice_totals.total_amount,
          credit_note_totals.credit_note_count,
          credit_note_totals.total_credited,
          (
            invoice_totals.failed_invoice_email_count +
            credit_note_totals.failed_credit_note_email_count
          )::text AS failed_email_count,
          invoice_totals.currency,
          GREATEST(
            invoice_totals.invoice_last_updated_at,
            COALESCE(
              credit_note_totals.credit_note_last_updated_at,
              invoice_totals.invoice_last_updated_at
            )
          )::text AS last_updated_at
        FROM invoice_totals
        CROSS JOIN credit_note_totals
      `
    )
  ]);
  const summaryRow = summaryResult.rows[0];
  const creditNotesByInvoice = await listAdminSponsorshipCreditNotesForInvoices(
    pool,
    invoiceResult.rows.map((row) => row.id)
  );
  const summary: AdminSponsorshipInvoicesSummary = {
    total_count: parseDbInt(summaryRow?.total_count ?? '0'),
    total_amount: centsToAmount(parseDbInt(summaryRow?.total_amount ?? '0')),
    credit_note_count: parseDbInt(summaryRow?.credit_note_count ?? '0'),
    total_credited: centsToAmount(
      parseDbInt(summaryRow?.total_credited ?? '0')
    ),
    failed_email_count: parseDbInt(summaryRow?.failed_email_count ?? '0'),
    currency: (summaryRow?.currency ?? 'cad').toUpperCase()
  };

  return {
    data_source: 'database',
    invoices: invoiceResult.rows.map((row) =>
      mapAdminSponsorshipInvoiceRow(row, creditNotesByInvoice.get(row.id) ?? [])
    ),
    summary,
    last_updated_at: summaryRow?.last_updated_at ?? now
  };
};
