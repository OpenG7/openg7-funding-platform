import type {
  AdminSponsorshipCreditNoteRecord,
  AdminSponsorshipInvoiceLineItem,
  AdminSponsorshipInvoiceRecord
} from '@openg7/funding-core';

export interface SponsorshipInvoiceLineItem {
  readonly description: string;
  readonly quantity: number;
  readonly unitAmountCents: number;
  readonly totalCents: number;
}

interface SponsorshipDocumentRecord {
  readonly id: string;
  readonly contributionId: string;
  readonly invoiceNumber: string;
  readonly publicReference: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly issuedAtIso: string;
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

export interface SponsorshipInvoiceRecord extends SponsorshipDocumentRecord {
  readonly stripeSessionId: string;
  readonly paidAtIso: string | null;
}

export interface SponsorshipCreditNoteRecord extends SponsorshipDocumentRecord {
  readonly invoiceId: string;
  readonly creditNoteNumber: string;
  readonly stripeRefundId: string;
}

interface SponsorshipDocumentRow {
  readonly id: string;
  readonly contribution_id: string;
  readonly invoice_number: string;
  readonly public_reference: string | null;
  readonly stripe_payment_intent_id: string | null;
  readonly issued_at: string;
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

export interface SponsorshipInvoiceRow extends SponsorshipDocumentRow {
  readonly stripe_session_id: string;
  readonly paid_at: string | null;
}

export interface SponsorshipCreditNoteRow extends SponsorshipDocumentRow {
  readonly invoice_id: string;
  readonly credit_note_number: string;
  readonly stripe_refund_id: string;
}

interface SponsorshipDocumentEmailRow {
  readonly last_email_status: string | null;
  readonly last_email_recipient: string | null;
  readonly last_email_sent_at: string | null;
  readonly last_email_error: string | null;
}

export interface AdminSponsorshipInvoiceRow
  extends SponsorshipInvoiceRow, SponsorshipDocumentEmailRow {}

export interface AdminSponsorshipCreditNoteRow
  extends SponsorshipCreditNoteRow, SponsorshipDocumentEmailRow {}

export const parseDbInt = (value: string): number => Number.parseInt(value, 10);

export const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));

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

// Read the issued snapshot only; current issuer settings and sponsorship pricing
// must never change an existing document during download or email resend.
const mapSponsorshipDocumentRow = (
  row: SponsorshipDocumentRow
): SponsorshipDocumentRecord => ({
  id: row.id,
  contributionId: row.contribution_id,
  invoiceNumber: row.invoice_number,
  publicReference: row.public_reference,
  stripePaymentIntentId: row.stripe_payment_intent_id,
  issuedAtIso: row.issued_at,
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

export const mapSponsorshipInvoiceRow = (
  row: SponsorshipInvoiceRow
): SponsorshipInvoiceRecord => ({
  ...mapSponsorshipDocumentRow(row),
  stripeSessionId: row.stripe_session_id,
  paidAtIso: row.paid_at
});

export const mapSponsorshipCreditNoteRow = (
  row: SponsorshipCreditNoteRow
): SponsorshipCreditNoteRecord => ({
  ...mapSponsorshipDocumentRow(row),
  invoiceId: row.invoice_id,
  creditNoteNumber: row.credit_note_number,
  stripeRefundId: row.stripe_refund_id
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

type AdminSponsorshipDocumentRecord = Omit<
  AdminSponsorshipInvoiceRecord,
  'stripe_session_id' | 'paid_at' | 'credit_notes'
>;

const mapAdminSponsorshipDocumentRow = (
  row: SponsorshipDocumentRow & SponsorshipDocumentEmailRow
): AdminSponsorshipDocumentRecord => ({
  id: row.id,
  contribution_id: row.contribution_id,
  invoice_number: row.invoice_number,
  public_reference: row.public_reference,
  stripe_payment_intent_id: row.stripe_payment_intent_id,
  issued_at: row.issued_at,
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

export const mapAdminSponsorshipCreditNoteRow = (
  row: AdminSponsorshipCreditNoteRow
): AdminSponsorshipCreditNoteRecord => ({
  ...mapAdminSponsorshipDocumentRow(row),
  invoice_id: row.invoice_id,
  credit_note_number: row.credit_note_number,
  stripe_refund_id: row.stripe_refund_id
});

export const mapAdminSponsorshipInvoiceRow = (
  row: AdminSponsorshipInvoiceRow,
  creditNotes: readonly AdminSponsorshipCreditNoteRecord[] = []
): AdminSponsorshipInvoiceRecord => ({
  ...mapAdminSponsorshipDocumentRow(row),
  stripe_session_id: row.stripe_session_id,
  paid_at: row.paid_at,
  credit_notes: creditNotes
});
