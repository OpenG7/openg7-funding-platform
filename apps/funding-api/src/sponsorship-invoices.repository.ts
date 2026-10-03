import { createHash } from 'node:crypto';

import type { Pool } from 'pg';
import type {
  AdminSponsorshipCreditNoteRecord,
  AdminSponsorshipInvoiceBackfillError,
  AdminSponsorshipInvoiceBackfillResult,
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipInvoicesSummary
} from '@openg7/funding-core';

import { formatSponsorshipBenefitList } from './sponsorship-benefits.js';
import { sponsorshipInvoiceConfig } from './sponsorship-invoice-config.js';
import {
  centsToAmount,
  mapAdminSponsorshipCreditNoteRow,
  mapAdminSponsorshipInvoiceRow,
  mapSponsorshipCreditNoteRow,
  mapSponsorshipInvoiceRow,
  parseDbInt,
  type AdminSponsorshipCreditNoteRow,
  type AdminSponsorshipInvoiceRow,
  type SponsorshipCreditNoteRecord,
  type SponsorshipCreditNoteRow,
  type SponsorshipInvoiceLineItem,
  type SponsorshipInvoiceRecord,
  type SponsorshipInvoiceRow
} from './sponsorship-invoice.mapping.js';

export type {
  SponsorshipCreditNoteRecord,
  SponsorshipInvoiceLineItem,
  SponsorshipInvoiceRecord
} from './sponsorship-invoice.mapping.js';

export interface CreateSponsorshipInvoiceInput {
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly publicReference: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly paidAtIso: string | null;
  readonly customerEmail: string | null;
}

export interface CreateSponsorshipCreditNoteInput {
  readonly contributionId: string;
  readonly stripeRefundId: string;
  readonly refundAmountCents: number;
}

interface AdminSponsorshipInvoiceSummaryRow {
  readonly total_count: string;
  readonly total_amount: string;
  readonly credit_note_count: string;
  readonly total_credited: string;
  readonly failed_email_count: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

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

const {
  invoicePrefix,
  creditNotePrefix,
  issuerName: invoiceIssuerName,
  issuerEmail: invoiceIssuerEmail,
  issuerAddress: invoiceIssuerAddress,
  issuerTaxId: invoiceIssuerTaxId,
  taxLabel: invoiceTaxLabel,
  invoiceLegalNote,
  creditNoteLegalNote
} = sponsorshipInvoiceConfig;

const normalizeBackfillLimit = (value: number | undefined): number =>
  Number.isInteger(value) && value !== undefined
    ? Math.max(1, Math.min(value, 1000))
    : 250;

const errorMessageFromUnknown = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown sponsorship invoice error.';

const normalizeText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
};

const invoiceReferenceSuffix = (
  publicReference: string | null,
  stripeSessionId: string
): string => {
  if (publicReference) {
    return publicReference.replace(/^OG7-\d{4}-/u, '').replaceAll('-', '');
  }

  return createHash('sha256')
    .update(stripeSessionId)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
};

const createInvoiceNumber = (
  input: Pick<
    CreateSponsorshipInvoiceInput,
    'paidAtIso' | 'publicReference' | 'stripeSessionId'
  >
): string => {
  const year = new Date(input.paidAtIso ?? Date.now()).getUTCFullYear();
  return `${invoicePrefix}-${year}-${invoiceReferenceSuffix(
    input.publicReference,
    input.stripeSessionId
  )}`;
};

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

const sponsorshipInvoiceSelect = `
  invoice.id::text AS id,
  invoice.contribution_id::text AS contribution_id,
  invoice.invoice_number,
  invoice.public_reference,
  invoice.stripe_session_id,
  invoice.stripe_payment_intent_id,
  invoice.issued_at::text AS issued_at,
  invoice.paid_at::text AS paid_at,
  invoice.currency,
  invoice.subtotal_cents::text AS subtotal_cents,
  invoice.tax_cents::text AS tax_cents,
  invoice.total_cents::text AS total_cents,
  invoice.tax_label,
  invoice.issuer_name,
  invoice.issuer_email,
  invoice.issuer_address,
  invoice.issuer_tax_id,
  invoice.sponsor_name,
  invoice.sponsor_contact_name,
  invoice.sponsor_contact_email,
  invoice.sponsor_website_url,
  invoice.line_items,
  invoice.notes
`;

const latestEmailSelect = `
  latest_email.status AS last_email_status,
  latest_email.recipient_email AS last_email_recipient,
  latest_email.sent_at::text AS last_email_sent_at,
  latest_email.last_error AS last_email_error
`;

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

const sponsorshipCreditNoteSelect = `
  credit_note.id::text AS id,
  credit_note.invoice_id::text AS invoice_id,
  credit_note.contribution_id::text AS contribution_id,
  credit_note.credit_note_number,
  credit_note.invoice_number,
  credit_note.public_reference,
  credit_note.stripe_refund_id,
  credit_note.stripe_payment_intent_id,
  credit_note.issued_at::text AS issued_at,
  credit_note.currency,
  credit_note.subtotal_cents::text AS subtotal_cents,
  credit_note.tax_cents::text AS tax_cents,
  credit_note.total_cents::text AS total_cents,
  credit_note.tax_label,
  credit_note.issuer_name,
  credit_note.issuer_email,
  credit_note.issuer_address,
  credit_note.issuer_tax_id,
  credit_note.sponsor_name,
  credit_note.sponsor_contact_name,
  credit_note.sponsor_contact_email,
  credit_note.sponsor_website_url,
  credit_note.line_items,
  credit_note.notes
`;

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

export const createSponsorshipInvoiceForStripeSession = async (
  pool: Pool | null,
  input: CreateSponsorshipInvoiceInput
): Promise<SponsorshipInvoiceRecord | null> => {
  if (!pool) {
    return null;
  }

  const invoiceNumber = createInvoiceNumber(input);
  // Persist the benefits with the issued document: resends and PDF downloads
  // must not resolve them again against a future pricing configuration.
  const notes = [
    'Avantages de votre commandite :',
    ...formatSponsorshipBenefitList(
      centsToAmount(input.amountCents),
      input.currency
    ).map((benefit) => `- ${benefit}`),
    '',
    'Ces présences nécessitent votre consentement et une validation administrative. Aucune publication n’est automatique au paiement.',
    '',
    invoiceLegalNote
  ].join('\n');
  const lineItems: readonly SponsorshipInvoiceLineItem[] = [
    {
      description: 'Commandite de visibilite OpenG7 - Fonds des batisseurs',
      quantity: 1,
      unitAmountCents: input.amountCents,
      totalCents: input.amountCents
    }
  ];

  const result = await pool.query<SponsorshipInvoiceRow>(
    `
      WITH contribution AS (
        SELECT
          id,
          public_reference,
          stripe_session_id,
          stripe_payment_intent_id,
          amount_cents,
          currency,
          paid_at,
          email_private,
          public_name,
          sponsor_company_name,
          sponsor_contact_name,
          sponsor_contact_email,
          sponsor_website_url
        FROM fund_contributions
        WHERE stripe_session_id = $1
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
        LIMIT 1
      )
      INSERT INTO sponsorship_invoices (
        contribution_id,
        invoice_number,
        public_reference,
        stripe_session_id,
        stripe_payment_intent_id,
        issued_at,
        paid_at,
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
        contribution.id,
        $2,
        COALESCE(contribution.public_reference, $3),
        contribution.stripe_session_id,
        COALESCE($4, contribution.stripe_payment_intent_id),
        NOW(),
        COALESCE(contribution.paid_at, $5::timestamptz),
        contribution.currency,
        contribution.amount_cents,
        0,
        contribution.amount_cents,
        $6,
        $7,
        $8,
        $9,
        $10,
        COALESCE(
          NULLIF(btrim(contribution.sponsor_company_name), ''),
          NULLIF(btrim(contribution.public_name), ''),
          'Commanditaire a confirmer'
        ),
        contribution.sponsor_contact_name,
        COALESCE(
          NULLIF(btrim(contribution.sponsor_contact_email), ''),
          NULLIF(btrim(contribution.email_private), ''),
          $11
        ),
        contribution.sponsor_website_url,
        $12::jsonb,
        $13
      FROM contribution
      ON CONFLICT (contribution_id) DO UPDATE
      SET
        public_reference = COALESCE(
          sponsorship_invoices.public_reference,
          EXCLUDED.public_reference
        ),
        stripe_payment_intent_id = COALESCE(
          sponsorship_invoices.stripe_payment_intent_id,
          EXCLUDED.stripe_payment_intent_id
        ),
        paid_at = COALESCE(sponsorship_invoices.paid_at, EXCLUDED.paid_at),
        sponsor_name = CASE
          WHEN sponsorship_invoices.sponsor_name = 'Commanditaire a confirmer'
          THEN EXCLUDED.sponsor_name
          ELSE sponsorship_invoices.sponsor_name
        END,
        sponsor_contact_name = COALESCE(
          sponsorship_invoices.sponsor_contact_name,
          EXCLUDED.sponsor_contact_name
        ),
        sponsor_contact_email = COALESCE(
          sponsorship_invoices.sponsor_contact_email,
          EXCLUDED.sponsor_contact_email
        ),
        sponsor_website_url = COALESCE(
          sponsorship_invoices.sponsor_website_url,
          EXCLUDED.sponsor_website_url
        ),
        updated_at = NOW()
      RETURNING
        id::text AS id,
        contribution_id::text AS contribution_id,
        invoice_number,
        public_reference,
        stripe_session_id,
        stripe_payment_intent_id,
        issued_at::text AS issued_at,
        paid_at::text AS paid_at,
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
      input.stripeSessionId,
      invoiceNumber,
      input.publicReference,
      input.stripePaymentIntentId,
      input.paidAtIso,
      invoiceTaxLabel,
      invoiceIssuerName,
      normalizeText(invoiceIssuerEmail),
      normalizeText(invoiceIssuerAddress),
      normalizeText(invoiceIssuerTaxId),
      input.customerEmail,
      JSON.stringify(lineItems),
      notes
    ]
  );

  return result.rows[0] ? mapSponsorshipInvoiceRow(result.rows[0]) : null;
};

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

const listAdminSponsorshipCreditNotesForInvoices = async (
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
