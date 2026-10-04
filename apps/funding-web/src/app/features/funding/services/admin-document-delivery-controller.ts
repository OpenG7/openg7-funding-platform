import { computed, signal } from '@angular/core';
import { SPONSORSHIP_INVOICE_BACKFILL_CONFIRMATION } from '@openg7/funding-core';
import type {
  AdminSponsorshipCreditNoteRecord,
  AdminSponsorshipInvoiceBackfillResult,
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoiceResendResult
} from '@openg7/funding-core';

import type {
  AdminDocumentRecipientChange,
  DocumentDownloadState,
  DocumentResendState
} from '../pages/admin-invoices-page/admin-invoice.models.js';

import type { FundingAdminService } from './funding-admin.service.js';
import type { AdminDocumentDeliveryBrowser } from './admin-document-delivery-browser.js';

export interface AdminDocumentDeliveryPorts {
  readonly admin: Pick<
    FundingAdminService,
    | 'backfillSponsorshipInvoices'
    | 'resendSponsorshipInvoice'
    | 'resendSponsorshipCreditNote'
    | 'getSponsorshipInvoicePdf'
    | 'getSponsorshipCreditNotePdf'
  >;
  adminToken(): string;
  canManage(): boolean;
  invoices(): readonly AdminSponsorshipInvoiceRecord[];
  selectedInvoice(): AdminSponsorshipInvoiceRecord | null;
  contributionId(): string | undefined;
  refreshInvoices(): Promise<void>;
  confirm(message: string, detail?: string): Promise<boolean>;
  t(key: string, params?: Record<string, string | number>): string;
  browser(): AdminDocumentDeliveryBrowser | null;
}

type BackfillState = 'idle' | 'sending' | 'done' | 'error';
interface InvoiceResend {
  state: DocumentResendState;
  message: string;
  email: string;
}
interface DocumentDownload {
  state: DocumentDownloadState;
  message: string;
}
interface DocumentResendView {
  state(): DocumentResendState;
  setState(state: DocumentResendState): void;
  setMessage(message: string): void;
  sentMessage: string;
  queuedMessage: string;
}

/** Per-page document operations. Server facts, routes and presentation stay with the page. */
export class AdminDocumentDeliveryController {
  readonly backfillState = signal<BackfillState>('idle');
  readonly backfillMessage = signal('');
  private readonly invoiceResends = signal<
    Partial<Record<string, InvoiceResend>>
  >({});
  readonly resendState = computed(
    () =>
      this.invoiceResends()[this.ports.selectedInvoice()?.id ?? '']?.state ??
      'idle'
  );
  readonly resendMessage = computed(
    () =>
      this.invoiceResends()[this.ports.selectedInvoice()?.id ?? '']?.message ??
      ''
  );
  readonly resendEmail = computed(() => {
    const invoice = this.ports.selectedInvoice();
    return invoice ? this.invoiceEmail(invoice) : '';
  });
  readonly resendMessageIds = signal<Record<string, string>>({});
  private readonly pendingResends = new Map<string, string>();
  private readonly activeResends = new Set<string>();
  private readonly pdfDownloads = signal<
    Partial<Record<string, DocumentDownload>>
  >({});
  readonly invoicePdfState = computed(
    () =>
      this.pdfDownloads()[`invoice:${this.ports.selectedInvoice()?.id}`]
        ?.state ?? 'idle'
  );
  readonly invoicePdfMessage = computed(
    () =>
      this.pdfDownloads()[`invoice:${this.ports.selectedInvoice()?.id}`]
        ?.message ?? ''
  );
  readonly creditNoteResendEmails = signal<Record<string, string>>({});
  readonly creditNoteResendStates = signal<Record<string, DocumentResendState>>(
    {}
  );
  readonly creditNoteResendMessages = signal<Record<string, string>>({});
  private scope = 0;
  private disposed = false;
  private backfillPending = false;

  constructor(private readonly ports: AdminDocumentDeliveryPorts) {}

  resetScope(): void {
    if (this.disposed) return;
    this.scope++;
    this.invoiceResends.set({});
    this.pdfDownloads.set({});
    this.resendMessageIds.set({});
    this.creditNoteResendEmails.set({});
    this.creditNoteResendStates.set({});
    this.creditNoteResendMessages.set({});
    this.backfillState.set('idle');
    this.backfillMessage.set('');
  }

  dispose(): void {
    this.disposed = true;
    this.scope++;
    // Storage keeps uncertain requests available to the next page instance.
    this.pendingResends.clear();
  }

  setResendEmail(change: AdminDocumentRecipientChange): void {
    if (!this.disposed)
      this.updateInvoiceResend(change.id, { email: change.email });
  }

  creditNoteResendEmail(creditNote: AdminSponsorshipCreditNoteRecord): string {
    return (
      this.creditNoteResendEmails()[creditNote.id] ??
      creditNote.sponsor_contact_email ??
      ''
    );
  }

  setCreditNoteResendEmail(change: AdminDocumentRecipientChange): void {
    if (this.disposed) return;
    this.creditNoteResendEmails.update((emails) => ({
      ...emails,
      [change.id]: change.email
    }));
  }

  creditNoteResendStateFor(id: string): DocumentResendState {
    return this.creditNoteResendStates()[id] ?? 'idle';
  }

  creditNoteResendMessageFor(id: string): string {
    return this.creditNoteResendMessages()[id] ?? '';
  }

  creditNotePdfStateFor(id: string): DocumentDownloadState {
    return this.pdfDownloads()[`credit-note:${id}`]?.state ?? 'idle';
  }

  creditNotePdfMessageFor(id: string): string {
    return this.pdfDownloads()[`credit-note:${id}`]?.message ?? '';
  }

  ensureCreditNoteResendDrafts(invoice: AdminSponsorshipInvoiceRecord): void {
    if (this.disposed) return;
    this.creditNoteResendEmails.update((emails) => ({
      ...Object.fromEntries(
        invoice.credit_notes
          .filter((creditNote) => emails[creditNote.id] === undefined)
          .map((creditNote) => [
            creditNote.id,
            creditNote.sponsor_contact_email ?? ''
          ])
      ),
      ...emails
    }));
  }

  async downloadInvoicePdf(
    invoice: AdminSponsorshipInvoiceRecord
  ): Promise<void> {
    await this.downloadDocumentPdf(
      { kind: 'invoice', id: invoice.id, number: invoice.invoice_number },
      (token) => this.ports.admin.getSponsorshipInvoicePdf(token, invoice.id)
    );
  }

  async downloadCreditNotePdf(
    creditNote: AdminSponsorshipCreditNoteRecord
  ): Promise<void> {
    await this.downloadDocumentPdf(
      {
        kind: 'credit-note',
        id: creditNote.id,
        number: creditNote.credit_note_number
      },
      (token) =>
        this.ports.admin.getSponsorshipCreditNotePdf(token, creditNote.id)
    );
  }

  private async downloadDocumentPdf(
    document: { kind: 'invoice' | 'credit-note'; id: string; number: string },
    load: (token: string) => Promise<Blob>
  ): Promise<void> {
    const browser = this.ports.browser();
    const token = this.ports.adminToken();
    const scope = this.scope;
    const key = `${document.kind}:${document.id}`;
    if (
      !this.isActive(scope) ||
      !browser ||
      !token ||
      this.pdfDownloads()[key]?.state === 'loading'
    )
      return;
    this.setPdfDownload(key, { state: 'loading', message: '' });
    try {
      const blob = await load(token);
      if (!this.isActive(scope)) return;
      browser.saveBlob(blob, this.pdfFilename(document.number));
      this.setPdfDownload(key, { state: 'idle', message: '' });
    } catch (error) {
      if (this.isActive(scope))
        this.setPdfDownload(key, {
          state: 'error',
          message: this.messageFromError(error)
        });
    }
  }

  async resendInvoice(invoice: AdminSponsorshipInvoiceRecord): Promise<void> {
    const to = this.invoiceEmail(invoice).trim();
    if (!to) return;
    await this.resendDocument(
      { id: invoice.id, number: invoice.invoice_number, to },
      {
        state: () => this.invoiceResends()[invoice.id]?.state ?? 'idle',
        setState: (state) => this.updateInvoiceResend(invoice.id, { state }),
        setMessage: (message) =>
          this.updateInvoiceResend(invoice.id, { message }),
        sentMessage: 'admin.messages.facture_envoyee',
        queuedMessage: 'admin.messages.facture_remise_en_file'
      },
      (token, requestId) =>
        this.ports.admin.resendSponsorshipInvoice(token, {
          invoiceId: invoice.id,
          to,
          confirmation: invoice.id,
          requestId
        })
    );
  }

  async resendCreditNote(
    creditNote: AdminSponsorshipCreditNoteRecord
  ): Promise<void> {
    const to = this.creditNoteResendEmail(creditNote).trim();
    if (!to) return;
    await this.resendDocument(
      { id: creditNote.id, number: creditNote.credit_note_number, to },
      {
        state: () => this.creditNoteResendStateFor(creditNote.id),
        setState: (state) =>
          this.creditNoteResendStates.update((states) => ({
            ...states,
            [creditNote.id]: state
          })),
        setMessage: (message) =>
          this.creditNoteResendMessages.update((messages) => ({
            ...messages,
            [creditNote.id]: message
          })),
        sentMessage: 'admin.messages.avoir_envoye',
        queuedMessage: 'admin.messages.avoir_remis_en_file'
      },
      (token, requestId) =>
        this.ports.admin.resendSponsorshipCreditNote(token, {
          creditNoteId: creditNote.id,
          to,
          confirmation: creditNote.id,
          requestId
        })
    );
  }

  private async resendDocument<
    TResult extends Pick<
      AdminSponsorshipInvoiceResendResult,
      'sent' | 'queued' | 'messageId'
    >
  >(
    document: { id: string; number: string; to: string },
    view: DocumentResendView,
    send: (token: string, requestId: string) => Promise<TResult>
  ): Promise<void> {
    const scope = this.scope;
    const browser = this.ports.browser();
    if (
      !this.canMutate(scope) ||
      !browser ||
      this.activeResends.has(document.id) ||
      ['confirming', 'sending'].includes(view.state())
    )
      return;
    this.activeResends.add(document.id);
    view.setState('confirming');
    try {
      const confirmed = await this.ports.confirm(
        this.ports.t('admin.confirmation.retryEmail'),
        `${document.number} → ${document.to}`
      );
      if (!this.isActive(scope)) return;
      if (!confirmed || !this.canMutate(scope)) {
        view.setState('idle');
        return;
      }
      view.setMessage('');
      view.setState('sending');
      const pending = await this.resendRequest(
        browser,
        scope,
        document.id,
        document.to
      );
      if (!pending) {
        if (this.isActive(scope)) view.setState('idle');
        return;
      }
      if (!this.canMutate(scope)) {
        if (this.isActive(scope)) view.setState('idle');
        return;
      }
      const result = await send(this.ports.adminToken(), pending.requestId);
      if (!this.isActive(scope)) return;
      this.completeResend(browser, pending.key);
      await this.ports.refreshInvoices();
      if (!this.isActive(scope)) return;
      if (result.messageId)
        this.resendMessageIds.update((ids) => ({
          ...ids,
          [document.id]: result.messageId!
        }));
      view.setState('sent');
      view.setMessage(
        this.ports.t(
          result.sent
            ? view.sentMessage
            : result.queued
              ? view.queuedMessage
              : 'admin.messages.demande_traitee'
        )
      );
    } catch (error) {
      if (!this.isActive(scope)) return;
      view.setState('error');
      view.setMessage(this.messageFromError(error));
    } finally {
      this.activeResends.delete(document.id);
    }
  }

  async backfillInvoices(): Promise<void> {
    const scope = this.scope;
    if (!this.canMutate(scope) || !this.ports.browser() || this.backfillPending)
      return;
    const contributionId = this.ports.contributionId();
    this.backfillPending = true;
    try {
      const confirmed = await this.ports.confirm(
        this.ports
          .t(
            contributionId
              ? 'admin.attention.confirmInvoice'
              : 'admin.confirmation.backfill'
          )
          .replace('{{id}}', contributionId ?? '')
      );
      if (!confirmed || !this.canMutate(scope)) return;
      this.backfillState.set('sending');
      this.backfillMessage.set('');
      const result = await this.ports.admin.backfillSponsorshipInvoices(
        this.ports.adminToken(),
        {
          limit: contributionId ? 1 : 250,
          contributionId,
          confirmation:
            contributionId ?? SPONSORSHIP_INVOICE_BACKFILL_CONFIRMATION
        }
      );
      if (!this.isActive(scope)) return;
      this.backfillState.set(result.failed_count > 0 ? 'error' : 'done');
      this.backfillMessage.set(this.backfillResultMessage(result));
      await this.ports.refreshInvoices();
    } catch (error) {
      if (!this.isActive(scope)) return;
      this.backfillState.set('error');
      this.backfillMessage.set(this.messageFromError(error));
    } finally {
      this.backfillPending = false;
    }
  }

  private async resendRequest(
    browser: AdminDocumentDeliveryBrowser,
    scope: number,
    id: string,
    to: string
  ): Promise<{ key: string; requestId: string } | null> {
    const digest = await browser.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${id}:${to}`)
    );
    if (!this.canMutate(scope)) {
      return null;
    }
    const key =
      'openg7-admin-document-resend:' +
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
    let requestId = this.pendingResends.get(key);
    try {
      requestId ??= browser.storage()?.getItem(key) ?? undefined;
    } catch {
      /* Memory fallback when browser storage is unavailable. */
    }
    requestId ??= browser.crypto.randomUUID();
    this.pendingResends.set(key, requestId);
    try {
      browser.storage()?.setItem(key, requestId);
    } catch {
      /* Retain the request in memory. */
    }
    return { key, requestId };
  }

  private completeResend(
    browser: AdminDocumentDeliveryBrowser,
    key: string
  ): void {
    this.pendingResends.delete(key);
    try {
      browser.storage()?.removeItem(key);
    } catch {
      /* A retained UUID can only deduplicate a later retry. */
    }
  }

  private invoiceEmail(invoice: AdminSponsorshipInvoiceRecord): string {
    return (
      this.invoiceResends()[invoice.id]?.email ??
      invoice.sponsor_contact_email ??
      ''
    );
  }

  private updateInvoiceResend(
    id: string,
    update: Partial<InvoiceResend>
  ): void {
    this.invoiceResends.update((resends) => ({
      ...resends,
      [id]: {
        state: 'idle',
        message: '',
        email:
          this.ports.invoices().find((invoice) => invoice.id === id)
            ?.sponsor_contact_email ?? '',
        ...resends[id],
        ...update
      }
    }));
  }

  private setPdfDownload(key: string, download: DocumentDownload): void {
    this.pdfDownloads.update((downloads) => ({
      ...downloads,
      [key]: download
    }));
  }

  private pdfFilename(documentNumber: string): string {
    const safeDocumentNumber = documentNumber
      .replace(/[^A-Za-z0-9._-]+/gu, '-')
      .replace(/^-+|-+$/gu, '');
    return `openg7-${safeDocumentNumber || 'document'}.pdf`;
  }

  private backfillResultMessage(
    result: AdminSponsorshipInvoiceBackfillResult
  ): string {
    if (result.eligible_count === 0)
      return this.ports.t(
        'admin.messages.aucune_commandite_payee_admissible_a_facturer'
      );
    if (result.missing_count === 0)
      return this.ports.t(
        'admin.messages.backfill_termine_aucune_facture_manquante_p0_deja_presente_s',
        { p0: result.skipped_count }
      );
    const remaining =
      result.remaining_count > 0
        ? this.ports.t('admin.messages.p0_restante_s_relancez_le_backfill', {
            p0: result.remaining_count
          })
        : '';
    return this.ports.t(
      'admin.messages.backfill_termine_p0_facture_s_creee_s_p1_deja_presente_s_p2_erreur_s_p3',
      {
        p0: result.created_count,
        p1: result.skipped_count,
        p2: result.failed_count,
        p3: remaining
      }
    );
  }

  private messageFromError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : this.ports.t('admin.messages.operation_admin_impossible');
  }

  private isActive(scope: number): boolean {
    return !this.disposed && scope === this.scope;
  }

  private canMutate(scope: number): boolean {
    return (
      this.isActive(scope) &&
      this.ports.canManage() &&
      Boolean(this.ports.adminToken())
    );
  }
}
