export interface AdminSponsorshipInvoiceLineItem {
  readonly description: string;
  readonly quantity: number;
  readonly unit_amount: number;
  readonly total: number;
}

export interface AdminSponsorshipCreditNoteRecord {
  readonly id: string;
  readonly invoice_id: string;
  readonly contribution_id: string;
  readonly credit_note_number: string;
  readonly invoice_number: string;
  readonly public_reference: string | null;
  readonly stripe_refund_id: string;
  readonly stripe_payment_intent_id: string | null;
  readonly issued_at: string;
  readonly currency: string;
  readonly subtotal: number;
  readonly tax: number;
  readonly total: number;
  readonly tax_label: string;
  readonly issuer_name: string;
  readonly issuer_email: string | null;
  readonly issuer_address: string | null;
  readonly issuer_tax_id: string | null;
  readonly sponsor_name: string;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_website_url: string | null;
  readonly line_items: readonly AdminSponsorshipInvoiceLineItem[];
  readonly notes: string | null;
  readonly last_email_status: string | null;
  readonly last_email_recipient: string | null;
  readonly last_email_sent_at: string | null;
  readonly last_email_error: string | null;
}

export interface AdminSponsorshipInvoiceRecord {
  readonly id: string;
  readonly contribution_id: string;
  readonly invoice_number: string;
  readonly public_reference: string | null;
  readonly stripe_session_id: string;
  readonly stripe_payment_intent_id: string | null;
  readonly issued_at: string;
  readonly paid_at: string | null;
  readonly currency: string;
  readonly subtotal: number;
  readonly tax: number;
  readonly total: number;
  readonly tax_label: string;
  readonly issuer_name: string;
  readonly issuer_email: string | null;
  readonly issuer_address: string | null;
  readonly issuer_tax_id: string | null;
  readonly sponsor_name: string;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_website_url: string | null;
  readonly line_items: readonly AdminSponsorshipInvoiceLineItem[];
  readonly notes: string | null;
  readonly last_email_status: string | null;
  readonly last_email_recipient: string | null;
  readonly last_email_sent_at: string | null;
  readonly last_email_error: string | null;
  readonly credit_notes: readonly AdminSponsorshipCreditNoteRecord[];
}

export interface AdminSponsorshipInvoicesSummary {
  readonly total_count: number;
  readonly total_amount: number;
  readonly credit_note_count: number;
  readonly total_credited: number;
  readonly failed_email_count: number;
  readonly currency: string;
}

export interface AdminSponsorshipInvoicesResponse {
  readonly data_source: 'database';
  readonly invoices: readonly AdminSponsorshipInvoiceRecord[];
  readonly summary: AdminSponsorshipInvoicesSummary;
  readonly last_updated_at: string;
}

export const SPONSORSHIP_INVOICE_BACKFILL_CONFIRMATION = 'BACKFILL_INVOICES';

export interface AdminSponsorshipInvoiceBackfillRequest {
  readonly confirmation: string;
  readonly contributionId?: string;
  readonly limit?: number;
}

export interface AdminSponsorshipInvoiceBackfillError {
  readonly contribution_id: string;
  readonly stripe_session_id: string | null;
  readonly error: string;
}

export interface AdminSponsorshipInvoiceBackfillResult {
  readonly data_source: 'database';
  readonly eligible_count: number;
  readonly missing_count: number;
  readonly processed_count: number;
  readonly created_count: number;
  readonly skipped_count: number;
  readonly remaining_count: number;
  readonly failed_count: number;
  readonly invoiceIds: readonly string[];
  readonly invoices: readonly AdminSponsorshipInvoiceRecord[];
  readonly errors: readonly AdminSponsorshipInvoiceBackfillError[];
  readonly last_updated_at: string;
}

export interface AdminSponsorshipInvoiceResendRequest {
  readonly invoiceId: string;
  readonly to: string;
  readonly confirmation: string;
  readonly requestId: string;
}

export interface AdminSponsorshipInvoiceResendResult {
  readonly queued: boolean;
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly messageId: string | null;
  readonly error: string | null;
  readonly invoice: AdminSponsorshipInvoiceRecord | null;
}

export interface AdminSponsorshipCreditNoteResendRequest {
  readonly creditNoteId: string;
  readonly to: string;
  readonly confirmation: string;
  readonly requestId: string;
}

export interface AdminSponsorshipCreditNoteResendResult {
  readonly queued: boolean;
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly messageId: string | null;
  readonly error: string | null;
  readonly creditNote: AdminSponsorshipCreditNoteRecord | null;
}
