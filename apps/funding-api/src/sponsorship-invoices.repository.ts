import { createHash } from 'node:crypto';

import type { Pool } from 'pg';
import type {
  AdminSponsorshipInvoiceLineItem,
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipInvoicesSummary
} from '@openg7/funding-core';

export interface SponsorshipInvoiceLineItem {
  readonly description: string;
  readonly quantity: number;
  readonly unitAmountCents: number;
  readonly totalCents: number;
}

export interface SponsorshipInvoiceRecord {
  readonly id: string;
  readonly contributionId: string;
  readonly invoiceNumber: string;
  readonly publicReference: string | null;
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly issuedAtIso: string;
  readonly paidAtIso: string | null;
  readonly currency: string;
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly taxLabel: string;
  readonly issuerName: string;
  readonly issuerEmail: string | null;
  readonly issuerAddress: string | null;
  readonly issuerTaxId: string | null;
  readonly sponsorName: string;
  readonly sponsorContactName: string | null;
  readonly sponsorContactEmail: string | null;
  readonly sponsorWebsiteUrl: string | null;
  readonly lineItems: readonly SponsorshipInvoiceLineItem[];
  readonly notes: string | null;
}

export interface CreateSponsorshipInvoiceInput {
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly publicReference: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly paidAtIso: string | null;
  readonly customerEmail: string | null;
}

interface SponsorshipInvoiceRow {
  readonly id: string;
  readonly contribution_id: string;
  readonly invoice_number: string;
  readonly public_reference: string | null;
  readonly stripe_session_id: string;
  readonly stripe_payment_intent_id: string | null;
  readonly issued_at: string;
  readonly paid_at: string | null;
  readonly currency: string;
  readonly subtotal_cents: string;
  readonly tax_cents: string;
  readonly total_cents: string;
  readonly tax_label: string;
  readonly issuer_name: string;
  readonly issuer_email: string | null;
  readonly issuer_address: string | null;
  readonly issuer_tax_id: string | null;
  readonly sponsor_name: string;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_website_url: string | null;
  readonly line_items: unknown;
  readonly notes: string | null;
}

interface AdminSponsorshipInvoiceRow extends SponsorshipInvoiceRow {
  readonly last_email_status: string | null;
  readonly last_email_recipient: string | null;
  readonly last_email_sent_at: string | null;
  readonly last_email_error: string | null;
}

interface AdminSponsorshipInvoiceSummaryRow {
  readonly total_count: string;
  readonly total_amount: string;
  readonly failed_email_count: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

const invoicePrefix =
  process.env.FUNDING_SPONSORSHIP_INVOICE_PREFIX?.trim() || 'OG7-CMD';
const invoiceIssuerName =
  process.env.FUNDING_INVOICE_ISSUER_NAME?.trim() || 'OpenG7';
const invoiceIssuerEmail =
  process.env.FUNDING_INVOICE_ISSUER_EMAIL?.trim() ||
  process.env.FUNDING_EMAIL_REPLY_TO?.trim() ||
  process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() ||
  '';
const invoiceIssuerAddress =
  process.env.FUNDING_INVOICE_ISSUER_ADDRESS?.trim() || '';
const invoiceIssuerTaxId = process.env.FUNDING_INVOICE_TAX_ID?.trim() || '';
const invoiceTaxLabel =
  process.env.FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL?.trim() ||
  'Taxes non calculees par la plateforme';
const invoiceLegalNote =
  process.env.FUNDING_SPONSORSHIP_INVOICE_LEGAL_NOTE?.trim() ||
  'Facture de commandite descriptive. Ce document ne constitue pas un recu officiel de don de bienfaisance.';

const parseDbInt = (value: string): number => Number.parseInt(value, 10);

const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));

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

const parseLineItems = (
  value: unknown
): readonly SponsorshipInvoiceLineItem[] => {
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const candidate = item as Record<string, unknown>;
      const description =
        typeof candidate.description === 'string' ? candidate.description : '';
      const quantity =
        typeof candidate.quantity === 'number' ? candidate.quantity : 1;
      const unitAmountCents =
        typeof candidate.unitAmountCents === 'number'
          ? candidate.unitAmountCents
          : 0;
      const totalCents =
        typeof candidate.totalCents === 'number' ? candidate.totalCents : 0;

      return description
        ? {
            description,
            quantity,
            unitAmountCents,
            totalCents
          }
        : null;
    })
    .filter((item): item is SponsorshipInvoiceLineItem => Boolean(item));
};

const mapSponsorshipInvoiceRow = (
  row: SponsorshipInvoiceRow
): SponsorshipInvoiceRecord => ({
  id: row.id,
  contributionId: row.contribution_id,
  invoiceNumber: row.invoice_number,
  publicReference: row.public_reference,
  stripeSessionId: row.stripe_session_id,
  stripePaymentIntentId: row.stripe_payment_intent_id,
  issuedAtIso: row.issued_at,
  paidAtIso: row.paid_at,
  currency: row.currency.toUpperCase(),
  subtotalCents: parseDbInt(row.subtotal_cents),
  taxCents: parseDbInt(row.tax_cents),
  totalCents: parseDbInt(row.total_cents),
  taxLabel: row.tax_label,
  issuerName: row.issuer_name,
  issuerEmail: row.issuer_email,
  issuerAddress: row.issuer_address,
  issuerTaxId: row.issuer_tax_id,
  sponsorName: row.sponsor_name,
  sponsorContactName: row.sponsor_contact_name,
  sponsorContactEmail: row.sponsor_contact_email,
  sponsorWebsiteUrl: row.sponsor_website_url,
  lineItems: parseLineItems(row.line_items),
  notes: row.notes
});

const adminInvoiceLineItems = (
  value: unknown
): readonly AdminSponsorshipInvoiceLineItem[] =>
  parseLineItems(value).map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit_amount: centsToAmount(item.unitAmountCents),
    total: centsToAmount(item.totalCents)
  }));

const mapAdminSponsorshipInvoiceRow = (
  row: AdminSponsorshipInvoiceRow
): AdminSponsorshipInvoiceRecord => ({
  id: row.id,
  contribution_id: row.contribution_id,
  invoice_number: row.invoice_number,
  public_reference: row.public_reference,
  stripe_session_id: row.stripe_session_id,
  stripe_payment_intent_id: row.stripe_payment_intent_id,
  issued_at: row.issued_at,
  paid_at: row.paid_at,
  currency: row.currency.toUpperCase(),
  subtotal: centsToAmount(parseDbInt(row.subtotal_cents)),
  tax: centsToAmount(parseDbInt(row.tax_cents)),
  total: centsToAmount(parseDbInt(row.total_cents)),
  tax_label: row.tax_label,
  issuer_name: row.issuer_name,
  issuer_email: row.issuer_email,
  issuer_address: row.issuer_address,
  issuer_tax_id: row.issuer_tax_id,
  sponsor_name: row.sponsor_name,
  sponsor_contact_name: row.sponsor_contact_name,
  sponsor_contact_email: row.sponsor_contact_email,
  sponsor_website_url: row.sponsor_website_url,
  line_items: adminInvoiceLineItems(row.line_items),
  notes: row.notes,
  last_email_status: row.last_email_status,
  last_email_recipient: row.last_email_recipient,
  last_email_sent_at: row.last_email_sent_at,
  last_email_error: row.last_email_error
});

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

export const createSponsorshipInvoiceForStripeSession = async (
  pool: Pool | null,
  input: CreateSponsorshipInvoiceInput
): Promise<SponsorshipInvoiceRecord | null> => {
  if (!pool) {
    return null;
  }

  const invoiceNumber = createInvoiceNumber(input);
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
      invoiceLegalNote
    ]
  );

  return result.rows[0] ? mapSponsorshipInvoiceRow(result.rows[0]) : null;
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

  return result.rows[0] ? mapAdminSponsorshipInvoiceRow(result.rows[0]) : null;
};

export const listAdminSponsorshipInvoices = async (
  pool: Pool | null
): Promise<AdminSponsorshipInvoicesResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      data_source: 'database',
      invoices: [],
      summary: {
        total_count: 0,
        total_amount: 0,
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
        ORDER BY invoice.issued_at DESC, invoice.created_at DESC
        LIMIT 250
      `
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
        )
        SELECT
          COUNT(invoice.id)::text AS total_count,
          COALESCE(SUM(invoice.total_cents), 0)::text AS total_amount,
          COALESCE(
            SUM(CASE WHEN latest_email.status = 'failed' THEN 1 ELSE 0 END),
            0
          )::text AS failed_email_count,
          COALESCE(MAX(invoice.currency), 'cad') AS currency,
          COALESCE(MAX(invoice.updated_at), NOW())::text AS last_updated_at
        FROM sponsorship_invoices invoice
        LEFT JOIN latest_email ON latest_email.invoice_id = invoice.id::text
      `
    )
  ]);
  const summaryRow = summaryResult.rows[0];
  const summary: AdminSponsorshipInvoicesSummary = {
    total_count: parseDbInt(summaryRow?.total_count ?? '0'),
    total_amount: centsToAmount(parseDbInt(summaryRow?.total_amount ?? '0')),
    failed_email_count: parseDbInt(summaryRow?.failed_email_count ?? '0'),
    currency: (summaryRow?.currency ?? 'cad').toUpperCase()
  };

  return {
    data_source: 'database',
    invoices: invoiceResult.rows.map(mapAdminSponsorshipInvoiceRow),
    summary,
    last_updated_at: summaryRow?.last_updated_at ?? now
  };
};
