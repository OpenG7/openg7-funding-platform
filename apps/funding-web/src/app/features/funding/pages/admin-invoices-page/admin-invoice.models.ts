import type {
  AdminSponsorshipCreditNoteRecord,
  AdminSponsorshipInvoiceRecord
} from '@openg7/funding-core';

export type DocumentResendState =
  'idle' | 'confirming' | 'sending' | 'sent' | 'error';
export type DocumentDownloadState = 'idle' | 'loading' | 'error';

/** Presentation snapshots only; the page owns document drafts and requests. */
export interface AdminDocumentDeliveryView {
  readonly id: string;
  readonly email: string;
  readonly state: DocumentResendState;
  readonly message: string;
  readonly messageId: string | null;
}

export interface AdminDocumentDownloadView {
  readonly state: DocumentDownloadState;
  readonly message: string;
}

export interface AdminDocumentRecipientChange {
  readonly id: string;
  readonly email: string;
}

export interface AdminInvoiceListRow {
  readonly invoice: AdminSponsorshipInvoiceRecord;
  readonly dateLabel: string;
  readonly totalLabel: string;
}

export interface AdminCreditNoteView {
  readonly record: AdminSponsorshipCreditNoteRecord;
  readonly totalLabel: string;
  readonly issuedAtLabel: string;
  readonly lastEmailSentAtLabel: string;
  readonly download: AdminDocumentDownloadView;
  readonly delivery: AdminDocumentDeliveryView;
}

export interface AdminInvoiceDetailView {
  readonly invoice: AdminSponsorshipInvoiceRecord;
  readonly totalLabel: string;
  readonly subtotalLabel: string;
  readonly taxLabel: string;
  readonly creditedTotalLabel: string;
  readonly paidAtLabel: string;
  readonly issuedAtLabel: string;
  readonly lastEmailSentAtLabel: string;
  readonly contactLabel: string;
  readonly lineItems: readonly {
    readonly line: AdminSponsorshipInvoiceRecord['line_items'][number];
    readonly unitAmountLabel: string;
    readonly totalLabel: string;
  }[];
  readonly creditNotes: readonly AdminCreditNoteView[];
  readonly download: AdminDocumentDownloadView;
  readonly delivery: AdminDocumentDeliveryView;
}
