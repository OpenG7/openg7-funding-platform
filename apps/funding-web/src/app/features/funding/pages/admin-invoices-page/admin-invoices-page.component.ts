import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import { SPONSORSHIP_INVOICE_BACKFILL_CONFIRMATION } from '@openg7/funding-core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type {
  AdminSponsorshipCreditNoteRecord,
  AdminSponsorshipInvoiceBackfillResult,
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoiceResendResult,
  AdminSponsorshipInvoicesResponse
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

import { AdminInvoiceListComponent } from './admin-invoice-list.component.js';
import { AdminInvoiceDetailComponent } from './admin-invoice-detail.component.js';
import type {
  AdminDocumentRecipientChange,
  AdminInvoiceDetailView,
  AdminInvoiceListRow,
  DocumentDownloadState,
  DocumentResendState
} from './admin-invoice.models.js';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type ResendState = DocumentResendState;
type DownloadState = DocumentDownloadState;
type BackfillState = 'idle' | 'sending' | 'done' | 'error';

interface DocumentResendView {
  state(): ResendState;
  setState(state: ResendState): void;
  setMessage(message: string): void;
  sentMessage: string;
  queuedMessage: string;
}

interface InvoiceResend {
  state: ResendState;
  message: string;
  email: string;
}

interface DocumentDownload {
  state: DownloadState;
  message: string;
}

@Component({
  selector: 'openg7-admin-invoices-page',
  standalone: true,
  imports: [
    CommonModule,
    AdminLayoutComponent,
    TranslatePipe,
    AdminInvoiceListComponent,
    AdminInvoiceDetailComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>{{ 'admin.legacy.administration' | translate }}</span>
            <h1>{{ 'admin.legacy.factures_commandite' | translate }}</h1>
          </div>
          <nav>
            <button
              type="button"
              (click)="backfillInvoices()"
              [disabled]="
                state() === 'loading' || backfillState() === 'sending'
              "
            >
              {{
                backfillState() === 'sending'
                  ? ('admin.legacy.generation' | translate)
                  : contributionId
                    ? ('admin.attention.generateInvoice' | translate)
                    : ('admin.legacy.generer_factures_manquantes' | translate)
              }}
            </button>
            <button
              type="button"
              (click)="loadInvoices()"
              [disabled]="state() === 'loading'"
            >
              {{ 'admin.legacy.actualiser' | translate }}
            </button>
          </nav>
        </header>

        @if (contributionId) {
          <p class="state" data-og7="attention-invoice-target">
            {{
              'admin.attention.targetInvoice'
                | translate: { id: contributionId }
            }}
          </p>
        }
        <p class="state" *ngIf="state() === 'loading'" aria-live="polite">
          {{ 'admin.legacy.chargement_des_factures' | translate }}
        </p>
        <p
          class="state state-error"
          *ngIf="state() === 'error'"
          aria-live="polite"
        >
          {{
            'admin.legacy.impossible_de_charger_les_factures_verifiez_database_url_et_la_mi'
              | translate
          }}
          {{ loadErrorMessage() }}
        </p>
        <p
          class="state"
          [class.state-error]="backfillState() === 'error'"
          *ngIf="backfillMessage()"
          aria-live="polite"
        >
          {{ backfillMessage() }}
        </p>

        <ng-container *ngIf="data() as response">
          <section
            class="admin-summary-grid"
            [attr.aria-label]="'admin.legacy.resume_factures' | translate"
          >
            <article>
              <span>{{ 'admin.legacy.factures' | translate }}</span>
              <strong>{{ response.summary.total_count }}</strong>
              <small>{{ 'admin.legacy.commandites_payees' | translate }}</small>
            </article>
            <article>
              <span>{{ 'admin.legacy.total_facture' | translate }}</span>
              <strong>
                {{
                  formatMoney(
                    response.summary.total_amount,
                    response.summary.currency
                  )
                }}
              </strong>
              <small>{{ response.summary.currency }}</small>
            </article>
            <article>
              <span>{{ 'admin.legacy.total_credite' | translate }}</span>
              <strong>
                {{
                  formatMoney(
                    response.summary.total_credited,
                    response.summary.currency
                  )
                }}
              </strong>
              <small>{{
                'admin.legacy.p0_avoir_s'
                  | translate: { p0: response.summary.credit_note_count }
              }}</small>
            </article>
            <article>
              <span>{{ 'admin.legacy.courriels_echoues' | translate }}</span>
              <strong>{{ response.summary.failed_email_count }}</strong>
              <small>{{
                'admin.legacy.dernier_statut_facture' | translate
              }}</small>
            </article>
            <article>
              <span>{{ 'admin.legacy.mis_a_jour' | translate }}</span>
              <strong>{{ shortDateLabel(response.last_updated_at) }}</strong>
              <small>{{ 'admin.legacy.snapshot_admin' | translate }}</small>
            </article>
          </section>

          <section
            class="invoices-board"
            [attr.aria-label]="'admin.legacy.factures_admin' | translate"
          >
            <openg7-admin-invoice-list
              [rows]="invoiceListRows()"
              [selectedId]="selectedInvoiceId()"
              (selected)="selectInvoice($event)"
            />
            <openg7-admin-invoice-detail
              [view]="invoiceDetailView()"
              (invoiceDownload)="downloadInvoicePdf($event)"
              (invoiceInspection)="
                inspection.invoice($event.id, $event.contribution_id)
              "
              (invoiceResend)="resendInvoice($event)"
              (invoiceRecipientChange)="setResendEmail($event)"
              (creditNoteDownload)="downloadCreditNotePdf($event)"
              (creditNoteResend)="resendCreditNote($event)"
              (creditNoteRecipientChange)="setCreditNoteResendEmail($event)"
            />
          </section>
        </ng-container>
      </section>
    </openg7-admin-layout>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-invoices-page.component.css'
  ]
})
export class AdminInvoicesPageComponent implements OnInit {
  private readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);

  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private loadGeneration = 0;
  contributionId: string | undefined;

  readonly adminToken = signal('');
  readonly state = signal<LoadState>('idle');
  readonly loadErrorMessage = signal('');
  readonly backfillState = signal<BackfillState>('idle');
  readonly backfillMessage = signal('');
  private readonly invoiceResends = signal<
    Partial<Record<string, InvoiceResend>>
  >({});
  readonly resendState = computed(
    () =>
      this.invoiceResends()[this.selectedInvoice()?.id ?? '']?.state ?? 'idle'
  );
  readonly resendMessage = computed(
    () => this.invoiceResends()[this.selectedInvoice()?.id ?? '']?.message ?? ''
  );
  readonly resendEmail = computed(() => {
    const invoice = this.selectedInvoice();
    return invoice
      ? (this.invoiceResends()[invoice.id]?.email ??
          invoice.sponsor_contact_email ??
          '')
      : '';
  });
  readonly resendMessageIds = signal<Record<string, string>>({});
  private readonly pendingResends = new Map<string, string>();

  // Called only by browser actions. Store an opaque fingerprint and UUID, never the recipient.
  private async resendRequest(
    id: string,
    to: string
  ): Promise<{ key: string; requestId: string }> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${id}:${to}`)
    );
    const key =
      'openg7-admin-document-resend:' +
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
    let requestId = this.pendingResends.get(key);
    try {
      requestId ??= sessionStorage.getItem(key) ?? undefined;
    } catch {
      /* Memory fallback when browser storage is unavailable. */
    }
    requestId ??= crypto.randomUUID();
    this.pendingResends.set(key, requestId);
    try {
      sessionStorage.setItem(key, requestId);
    } catch {
      /* Retain the request in memory. */
    }
    return { key, requestId };
  }

  private completeResend(key: string): void {
    this.pendingResends.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* A retained UUID can only deduplicate a later retry. */
    }
  }
  private readonly pdfDownloads = signal<
    Partial<Record<string, DocumentDownload>>
  >({});
  readonly invoicePdfState = computed(
    () =>
      this.pdfDownloads()[`invoice:${this.selectedInvoice()?.id}`]?.state ??
      'idle'
  );
  readonly invoicePdfMessage = computed(
    () =>
      this.pdfDownloads()[`invoice:${this.selectedInvoice()?.id}`]?.message ??
      ''
  );
  readonly creditNoteResendEmails = signal<Record<string, string>>({});
  readonly creditNoteResendStates = signal<Record<string, ResendState>>({});
  readonly creditNoteResendMessages = signal<Record<string, string>>({});
  readonly selectedInvoiceId = signal('');
  readonly data = signal<AdminSponsorshipInvoicesResponse | null>(null);
  readonly invoices = computed(() => this.data()?.invoices ?? []);
  readonly selectedInvoice = computed(() => {
    const selectedId = this.selectedInvoiceId();
    return (
      this.invoices().find((invoice) => invoice.id === selectedId) ??
      this.invoices()[0] ??
      null
    );
  });

  readonly invoiceListRows = computed<readonly AdminInvoiceListRow[]>(() =>
    this.invoices().map((invoice) => ({
      invoice,
      dateLabel: this.dateLabel(invoice.paid_at || invoice.issued_at),
      totalLabel: this.formatMoney(invoice.total, invoice.currency)
    }))
  );
  readonly invoiceDetailView = computed<AdminInvoiceDetailView | null>(() => {
    const invoice = this.selectedInvoice();
    if (!invoice) return null;
    return {
      invoice,
      totalLabel: this.formatMoney(invoice.total, invoice.currency),
      subtotalLabel: this.formatMoney(invoice.subtotal, invoice.currency),
      taxLabel: this.formatMoney(invoice.tax, invoice.currency),
      creditedTotalLabel: this.formatMoney(
        this.creditedTotal(invoice),
        invoice.currency
      ),
      paidAtLabel: this.dateLabel(invoice.paid_at),
      issuedAtLabel: this.dateLabel(invoice.issued_at),
      lastEmailSentAtLabel: this.dateLabel(invoice.last_email_sent_at),
      contactLabel: this.contactLabel(invoice),
      lineItems: invoice.line_items.map((line) => ({
        line,
        unitAmountLabel: this.formatMoney(line.unit_amount, invoice.currency),
        totalLabel: this.formatMoney(line.total, invoice.currency)
      })),
      creditNotes: invoice.credit_notes.map((creditNote) => ({
        record: creditNote,
        totalLabel: this.formatMoney(creditNote.total, creditNote.currency),
        issuedAtLabel: this.dateLabel(creditNote.issued_at),
        lastEmailSentAtLabel: this.dateLabel(creditNote.last_email_sent_at),
        download: {
          state: this.creditNotePdfStateFor(creditNote.id),
          message: this.creditNotePdfMessageFor(creditNote.id)
        },
        delivery: {
          id: creditNote.id,
          email: this.creditNoteResendEmail(creditNote),
          state: this.creditNoteResendStateFor(creditNote.id),
          message: this.creditNoteResendMessageFor(creditNote.id),
          messageId: this.resendMessageIds()[creditNote.id] ?? null
        }
      })),
      download: {
        state: this.invoicePdfState(),
        message: this.invoicePdfMessage()
      },
      delivery: {
        id: invoice.id,
        email: this.resendEmail(),
        state: this.resendState(),
        message: this.resendMessage(),
        messageId: this.resendMessageIds()[invoice.id] ?? null
      }
    };
  });

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroy.onDestroy(() => this.loadGeneration++);
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((params) => {
        this.contributionId = params.get('contributionId') ?? undefined;
        this.data.set(null);
        this.selectedInvoiceId.set('');
        this.backfillMessage.set('');
        void this.loadInvoices();
      });
  }

  async loadInvoices(): Promise<void> {
    const generation = ++this.loadGeneration;
    const token = this.adminToken() || this.admin.getSavedAdminToken();
    this.adminToken.set(token);
    this.state.set('loading');
    this.loadErrorMessage.set('');

    try {
      const response = await this.admin.getSponsorshipInvoices(
        token,
        this.contributionId
      );
      if (generation !== this.loadGeneration) return;
      this.data.set(response);
      const selectedStillExists = response.invoices.some(
        (invoice) => invoice.id === this.selectedInvoiceId()
      );
      const nextInvoice = selectedStillExists
        ? this.selectedInvoice()
        : (response.invoices[0] ?? null);
      this.selectedInvoiceId.set(nextInvoice?.id ?? '');
      if (nextInvoice) {
        this.ensureCreditNoteResendDrafts(nextInvoice);
      }
      this.state.set('ready');
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.state.set('error');
      this.loadErrorMessage.set(this.messageFromError(error));
    }
  }

  selectInvoice(invoice: AdminSponsorshipInvoiceRecord): void {
    this.selectedInvoiceId.set(invoice.id);
    this.ensureCreditNoteResendDrafts(invoice);
  }

  setResendEmail(change: AdminDocumentRecipientChange): void {
    this.updateInvoiceResend(change.id, { email: change.email });
  }

  async backfillInvoices(): Promise<void> {
    if (this.backfillState() === 'sending') return;
    if (
      !(await this.confirmation.confirm(
        this.i18n
          .t(
            this.contributionId
              ? 'admin.attention.confirmInvoice'
              : 'admin.confirmation.backfill'
          )
          .replace('{{id}}', this.contributionId ?? '')
      ))
    )
      return;
    const token = this.adminToken() || this.admin.getSavedAdminToken();
    this.adminToken.set(token);
    this.backfillState.set('sending');
    this.backfillMessage.set('');

    try {
      const result = await this.admin.backfillSponsorshipInvoices(token, {
        limit: this.contributionId ? 1 : 250,
        contributionId: this.contributionId,
        confirmation:
          this.contributionId ?? SPONSORSHIP_INVOICE_BACKFILL_CONFIRMATION
      });
      const message = this.backfillResultMessage(result);
      this.backfillState.set(result.failed_count > 0 ? 'error' : 'done');
      this.backfillMessage.set(message);
      await this.loadInvoices();
      this.backfillState.set(result.failed_count > 0 ? 'error' : 'done');
      this.backfillMessage.set(message);
    } catch (error) {
      this.backfillState.set('error');
      this.backfillMessage.set(this.messageFromError(error));
    }
  }

  creditNoteResendEmail(creditNote: AdminSponsorshipCreditNoteRecord): string {
    return (
      this.creditNoteResendEmails()[creditNote.id] ??
      creditNote.sponsor_contact_email ??
      ''
    );
  }

  setCreditNoteResendEmail(change: AdminDocumentRecipientChange): void {
    this.creditNoteResendEmails.update((emails) => ({
      ...emails,
      [change.id]: change.email
    }));
  }

  creditNoteResendStateFor(id: string): ResendState {
    return this.creditNoteResendStates()[id] ?? 'idle';
  }

  creditNoteResendMessageFor(id: string): string {
    return this.creditNoteResendMessages()[id] ?? '';
  }

  creditNotePdfStateFor(id: string): DownloadState {
    return this.pdfDownloads()[`credit-note:${id}`]?.state ?? 'idle';
  }

  creditNotePdfMessageFor(id: string): string {
    return this.pdfDownloads()[`credit-note:${id}`]?.message ?? '';
  }

  async downloadInvoicePdf(
    invoice: AdminSponsorshipInvoiceRecord
  ): Promise<void> {
    await this.downloadDocumentPdf(
      { kind: 'invoice', id: invoice.id, number: invoice.invoice_number },
      () => this.admin.getSponsorshipInvoicePdf(this.adminToken(), invoice.id)
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
      () =>
        this.admin.getSponsorshipCreditNotePdf(this.adminToken(), creditNote.id)
    );
  }

  private async downloadDocumentPdf(
    document: { kind: 'invoice' | 'credit-note'; id: string; number: string },
    load: () => Promise<Blob>
  ): Promise<void> {
    const key = `${document.kind}:${document.id}`;
    if (this.pdfDownloads()[key]?.state === 'loading') return;
    this.setPdfDownload(key, { state: 'loading', message: '' });

    try {
      const blob = await load();
      this.saveBlob(blob, this.pdfFilename(document.number));
      this.setPdfDownload(key, { state: 'idle', message: '' });
    } catch (error) {
      this.setPdfDownload(key, {
        state: 'error',
        message: this.messageFromError(error)
      });
    }
  }

  async resendInvoice(invoice: AdminSponsorshipInvoiceRecord): Promise<void> {
    const to = (
      this.invoiceResends()[invoice.id]?.email ??
      invoice.sponsor_contact_email ??
      ''
    ).trim();
    if (!invoice || !to) {
      return;
    }

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
      (requestId) =>
        this.admin.resendSponsorshipInvoice(this.adminToken(), {
          invoiceId: invoice.id,
          to,
          confirmation: invoice.id,
          requestId
        }),
      (result) => {
        if (result.invoice) {
          this.replaceInvoice(result.invoice);
        }
      }
    );
  }

  async resendCreditNote(
    creditNote: AdminSponsorshipCreditNoteRecord
  ): Promise<void> {
    const to = this.creditNoteResendEmail(creditNote).trim();
    if (!to) {
      return;
    }

    await this.resendDocument(
      { id: creditNote.id, number: creditNote.credit_note_number, to },
      {
        state: () => this.creditNoteResendStateFor(creditNote.id),
        setState: (state) =>
          this.setCreditNoteResendState(creditNote.id, state),
        setMessage: (message) =>
          this.setCreditNoteResendMessage(creditNote.id, message),
        sentMessage: 'admin.messages.avoir_envoye',
        queuedMessage: 'admin.messages.avoir_remis_en_file'
      },
      (requestId) =>
        this.admin.resendSponsorshipCreditNote(this.adminToken(), {
          creditNoteId: creditNote.id,
          to,
          confirmation: creditNote.id,
          requestId
        }),
      (result) => {
        if (result.creditNote) {
          this.replaceCreditNote(result.creditNote);
        }
      }
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
    send: (requestId: string) => Promise<TResult>,
    applyResult: (result: TResult) => void
  ): Promise<void> {
    if (['confirming', 'sending'].includes(view.state())) return;
    view.setState('confirming');
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.retryEmail'),
        `${document.number} → ${document.to}`
      ))
    ) {
      view.setState('idle');
      return;
    }
    view.setMessage('');
    view.setState('sending');

    try {
      const pending = await this.resendRequest(document.id, document.to);
      const result = await send(pending.requestId);

      this.completeResend(pending.key);
      const messageId = result.messageId;
      if (messageId)
        this.resendMessageIds.update((ids) => ({
          ...ids,
          [document.id]: messageId
        }));
      applyResult(result);

      view.setState('sent');
      view.setMessage(
        result.sent
          ? this.i18n.t(view.sentMessage)
          : result.queued
            ? this.i18n.t(view.queuedMessage)
            : this.i18n.t('admin.messages.demande_traitee')
      );
    } catch (error) {
      view.setState('error');
      view.setMessage(this.messageFromError(error));
    }
  }

  creditedTotal(invoice: AdminSponsorshipInvoiceRecord): number {
    return invoice.credit_notes.reduce(
      (total, creditNote) => total + creditNote.total,
      0
    );
  }

  formatMoney(value: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: currency || 'CAD'
    }).format(value);
  }

  dateLabel(value: string | null): string {
    if (!value) {
      return this.i18n.t('admin.legacy.absent');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  shortDateLabel(value: string | null): string {
    if (!value) {
      return this.i18n.t('admin.legacy.absent');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium'
    }).format(date);
  }

  contactLabel(invoice: AdminSponsorshipInvoiceRecord): string {
    return invoice.sponsor_contact_name || invoice.sponsor_name;
  }

  private replaceInvoice(invoice: AdminSponsorshipInvoiceRecord): void {
    const current = this.data();
    if (!current?.invoices.some((candidate) => candidate.id === invoice.id)) {
      return;
    }

    this.data.set({
      ...current,
      invoices: current.invoices.map((candidate) =>
        candidate.id === invoice.id ? invoice : candidate
      ),
      last_updated_at: new Date().toISOString()
    });
  }

  private replaceCreditNote(
    creditNote: AdminSponsorshipCreditNoteRecord
  ): void {
    const current = this.data();
    if (!current) {
      return;
    }

    this.data.set({
      ...current,
      invoices: current.invoices.map((invoice) =>
        invoice.id === creditNote.invoice_id
          ? {
              ...invoice,
              credit_notes: invoice.credit_notes.map((candidate) =>
                candidate.id === creditNote.id ? creditNote : candidate
              )
            }
          : invoice
      ),
      last_updated_at: new Date().toISOString()
    });
    this.creditNoteResendEmails.update((emails) => ({
      ...emails,
      [creditNote.id]: creditNote.sponsor_contact_email ?? ''
    }));
  }

  private ensureCreditNoteResendDrafts(
    invoice: AdminSponsorshipInvoiceRecord
  ): void {
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
          this.invoices().find((invoice) => invoice.id === id)
            ?.sponsor_contact_email ?? '',
        ...resends[id],
        ...update
      }
    }));
  }

  private setCreditNoteResendState(id: string, state: ResendState): void {
    this.creditNoteResendStates.update((states) => ({
      ...states,
      [id]: state
    }));
  }

  private setCreditNoteResendMessage(id: string, message: string): void {
    this.creditNoteResendMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
  }

  private setPdfDownload(key: string, download: DocumentDownload): void {
    this.pdfDownloads.update((downloads) => ({
      ...downloads,
      [key]: download
    }));
  }

  private saveBlob(blob: Blob, filename: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
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
    if (result.eligible_count === 0) {
      return this.i18n.t(
        'admin.messages.aucune_commandite_payee_admissible_a_facturer'
      );
    }

    if (result.missing_count === 0) {
      return this.i18n.t(
        'admin.messages.backfill_termine_aucune_facture_manquante_p0_deja_presente_s',
        { p0: result.skipped_count }
      );
    }

    const remaining =
      result.remaining_count > 0
        ? this.i18n.t('admin.messages.p0_restante_s_relancez_le_backfill', {
            p0: result.remaining_count
          })
        : '';

    return this.i18n.t(
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
      : this.i18n.t('admin.messages.operation_admin_impossible');
  }
}
