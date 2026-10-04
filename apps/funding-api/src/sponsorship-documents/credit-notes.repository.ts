import { createHash } from 'node:crypto';

import type { Pool } from 'pg';
import type { AdminSponsorshipCreditNoteRecord } from '@openg7/funding-core';

import { sponsorshipInvoiceConfig } from '../sponsorship-invoice-config.js';
import {
  mapAdminSponsorshipCreditNoteRow,
  mapSponsorshipCreditNoteRow,
  parseDbInt,
  type AdminSponsorshipCreditNoteRow,
  type SponsorshipCreditNoteRecord,
  type SponsorshipCreditNoteRow,
  type SponsorshipInvoiceLineItem
} from '../sponsorship-invoice.mapping.js';

import type { CreateSponsorshipCreditNoteInput } from './contracts.js';
import { latestEmailSelect, sponsorshipCreditNoteSelect } from './queries.js';

const { invoicePrefix, creditNotePrefix, creditNoteLegalNote } =
  sponsorshipInvoiceConfig;

const createCreditNoteNumber = (
  invoiceNumber: string,
  stripeRefundId: string
): string => {
  const invoiceSuffix = invoiceNumber.startsWith(`${invoicePrefix}-`)
    ? invoiceNumber.slice(invoicePrefix.length + 1)
    : '';
  // One invoice can have several refunds. Include the refund identity even
  // when the invoice uses our prefix; existing numbers survive the upsert.
  const refundSuffix = createHash('sha256')
    .update(`${invoiceNumber}:${stripeRefundId}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();

  return `${creditNotePrefix}-${invoiceSuffix ? `${invoiceSuffix}-` : ''}${refundSuffix}`;
};

const latestCreditNoteEmailJoin = `
  LEFT JOIN LATERAL (
    SELECT status, recipient_email, sent_at, last_error
    FROM email_messages
    WHERE template_key = 'sponsorship_credit_note'
      AND metadata->>'creditNoteId' = credit_note.id::text
    ORDER BY created_at DESC
    LIMIT 1
  ) latest_email ON TRUE
`;

export const createSponsorshipCreditNoteForRefund = async (
  pool: Pool | null,
  input: CreateSponsorshipCreditNoteInput
): Promise<SponsorshipCreditNoteRecord | null> => {
  if (!pool) {
    return null;
  }

  const invoice = await pool.query<{
    readonly invoice_number: string;
    readonly total_cents: string;
  }>(
    `
      SELECT invoice_number, total_cents::text AS total_cents
      FROM sponsorship_invoices
      WHERE contribution_id = $1::uuid
      LIMIT 1
    `,
    [input.contributionId]
  );
  const invoiceNumber = invoice.rows[0]?.invoice_number ?? null;
  if (!invoiceNumber) {
    return null;
  }

  const creditNoteNumber = createCreditNoteNumber(
    invoiceNumber,
    input.stripeRefundId
  );
  const lineItems: readonly SponsorshipInvoiceLineItem[] = [
    {
      description:
        input.refundAmountCents < parseDbInt(invoice.rows[0]!.total_cents)
          ? 'Avoir - remboursement partiel de la commandite OpenG7'
          : 'Avoir - remboursement complet de la commandite OpenG7',
      quantity: 1,
      unitAmountCents: input.refundAmountCents,
      totalCents: input.refundAmountCents
    }
  ];

  const result = await pool.query<SponsorshipCreditNoteRow>(
    `
      WITH invoice AS (
        SELECT *
        FROM sponsorship_invoices
        WHERE contribution_id = $1::uuid
        LIMIT 1
      )
      INSERT INTO sponsorship_credit_notes (
        invoice_id,
        contribution_id,
        credit_note_number,
        invoice_number,
        public_reference,
        stripe_refund_id,
        stripe_payment_intent_id,
        issued_at,
        currency,
        subtotal_cents,
        tax_cents,
        total_cents,
        tax_label,
        issuer_name,
        issuer_email,
        issuer_address,
        issuer_tax_id,
        sponsor_name,
        sponsor_contact_name,
        sponsor_contact_email,
        sponsor_website_url,
        line_items,
        notes
      )
      SELECT
        invoice.id,
        invoice.contribution_id,
        $2,
        invoice.invoice_number,
        invoice.public_reference,
        $3,
        invoice.stripe_payment_intent_id,
        NOW(),
        invoice.currency,
        $4,
        0,
        $4,
        invoice.tax_label,
        invoice.issuer_name,
        invoice.issuer_email,
        invoice.issuer_address,
        invoice.issuer_tax_id,
        invoice.sponsor_name,
        invoice.sponsor_contact_name,
        invoice.sponsor_contact_email,
        invoice.sponsor_website_url,
        $5::jsonb,
        $6
      FROM invoice
      ON CONFLICT (stripe_refund_id) DO UPDATE
      SET
        updated_at = NOW()
      RETURNING
        id::text AS id,
        invoice_id::text AS invoice_id,
        contribution_id::text AS contribution_id,
        credit_note_number,
        invoice_number,
        public_reference,
        stripe_refund_id,
        stripe_payment_intent_id,
        issued_at::text AS issued_at,
        currency,
        subtotal_cents::text AS subtotal_cents,
        tax_cents::text AS tax_cents,
        total_cents::text AS total_cents,
        tax_label,
        issuer_name,
        issuer_email,
        issuer_address,
        issuer_tax_id,
        sponsor_name,
        sponsor_contact_name,
        sponsor_contact_email,
        sponsor_website_url,
        line_items,
        notes
    `,
    [
      input.contributionId,
      creditNoteNumber,
      input.stripeRefundId,
      input.refundAmountCents,
      JSON.stringify(lineItems),
      creditNoteLegalNote
    ]
  );

  return result.rows[0] ? mapSponsorshipCreditNoteRow(result.rows[0]) : null;
};

export const getSponsorshipCreditNoteById = async (
  pool: Pool | null,
  creditNoteId: string
): Promise<SponsorshipCreditNoteRecord | null> => {
  if (!pool) {
    return null;
  }

  const result = await pool.query<SponsorshipCreditNoteRow>(
    `
      SELECT ${sponsorshipCreditNoteSelect}
      FROM sponsorship_credit_notes credit_note
      WHERE credit_note.id = $1::uuid
      LIMIT 1
    `,
    [creditNoteId]
  );

  return result.rows[0] ? mapSponsorshipCreditNoteRow(result.rows[0]) : null;
};

export const getAdminSponsorshipCreditNoteById = async (
  pool: Pool | null,
  creditNoteId: string
): Promise<AdminSponsorshipCreditNoteRecord | null> => {
  if (!pool) {
    return null;
  }

  const result = await pool.query<AdminSponsorshipCreditNoteRow>(
    `
      SELECT ${sponsorshipCreditNoteSelect}, ${latestEmailSelect}
      FROM sponsorship_credit_notes credit_note
      ${latestCreditNoteEmailJoin}
      WHERE credit_note.id = $1::uuid
      LIMIT 1
    `,
    [creditNoteId]
  );

  return result.rows[0]
    ? mapAdminSponsorshipCreditNoteRow(result.rows[0])
    : null;
};

export const listAdminSponsorshipCreditNotesForInvoices = async (
  pool: Pool,
  invoiceIds: readonly string[]
): Promise<Map<string, readonly AdminSponsorshipCreditNoteRecord[]>> => {
  if (invoiceIds.length === 0) {
    return new Map();
  }

  const result = await pool.query<AdminSponsorshipCreditNoteRow>(
    `
      SELECT ${sponsorshipCreditNoteSelect}, ${latestEmailSelect}
      FROM sponsorship_credit_notes credit_note
      ${latestCreditNoteEmailJoin}
      WHERE credit_note.invoice_id = ANY($1::uuid[])
      ORDER BY credit_note.issued_at DESC, credit_note.created_at DESC
    `,
    [invoiceIds]
  );

  const grouped = new Map<string, AdminSponsorshipCreditNoteRecord[]>();
  for (const row of result.rows) {
    const items = grouped.get(row.invoice_id) ?? [];
    items.push(mapAdminSponsorshipCreditNoteRow(row));
    grouped.set(row.invoice_id, items);
  }

  return grouped;
};
