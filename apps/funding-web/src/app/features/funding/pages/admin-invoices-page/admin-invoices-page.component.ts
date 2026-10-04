import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
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
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoicesResponse
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDocumentDeliveryController } from '../../services/admin-document-delivery-controller.js';
import { adminDocumentDeliveryBrowser } from '../../services/admin-document-delivery-browser.js';

import { AdminInvoiceListComponent } from './admin-invoice-list.component.js';
import { AdminInvoiceDetailComponent } from './admin-invoice-detail.component.js';
import type {
  AdminDocumentRecipientChange,
  AdminInvoiceDetailView,
  AdminInvoiceListRow
} from './admin-invoice.models.js';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

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
                !canManage() ||
                state() === 'loading' ||
                backfillState() === 'sending'
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
              [canManage]="canManage()"
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

  readonly canManage = computed(() => this.admin.identity()?.role !== 'reader');
  private readonly delivery = new AdminDocumentDeliveryController({
    admin: this.admin,
    adminToken: () => {
      const token = this.adminToken() || this.admin.getSavedAdminToken();
      this.adminToken.set(token);
      return token;
    },
    canManage: () => this.canManage(),
    invoices: () => this.invoices(),
    selectedInvoice: () => this.selectedInvoice(),
    contributionId: () => this.contributionId,
    refreshInvoices: () => this.loadInvoices(),
    confirm: (message, detail) => this.confirmation.confirm(message, detail),
    t: (key, params) => this.i18n.t(key, params),
    browser: adminDocumentDeliveryBrowser
  });
  readonly backfillState = this.delivery.backfillState;
  readonly backfillMessage = this.delivery.backfillMessage;
  readonly resendState = this.delivery.resendState;
  readonly resendMessage = this.delivery.resendMessage;
  readonly resendEmail = this.delivery.resendEmail;
  readonly resendMessageIds = this.delivery.resendMessageIds;
  readonly invoicePdfState = this.delivery.invoicePdfState;
  readonly invoicePdfMessage = this.delivery.invoicePdfMessage;

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
          state: this.delivery.creditNotePdfStateFor(creditNote.id),
          message: this.delivery.creditNotePdfMessageFor(creditNote.id)
        },
        delivery: {
          id: creditNote.id,
          email: this.delivery.creditNoteResendEmail(creditNote),
          state: this.delivery.creditNoteResendStateFor(creditNote.id),
          message: this.delivery.creditNoteResendMessageFor(creditNote.id),
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
    this.destroy.onDestroy(() => {
      this.loadGeneration++;
      this.delivery.dispose();
    });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((params) => {
        this.contributionId = params.get('contributionId') ?? undefined;
        this.data.set(null);
        this.selectedInvoiceId.set('');
        this.delivery.resetScope();
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
        this.delivery.ensureCreditNoteResendDrafts(nextInvoice);
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
    this.delivery.ensureCreditNoteResendDrafts(invoice);
  }

  setResendEmail(change: AdminDocumentRecipientChange): void {
    this.delivery.setResendEmail(change);
  }

  setCreditNoteResendEmail(change: AdminDocumentRecipientChange): void {
    this.delivery.setCreditNoteResendEmail(change);
  }

  backfillInvoices(): Promise<void> {
    return this.delivery.backfillInvoices();
  }

  downloadInvoicePdf(invoice: AdminSponsorshipInvoiceRecord): Promise<void> {
    return this.delivery.downloadInvoicePdf(invoice);
  }

  downloadCreditNotePdf(
    creditNote: AdminSponsorshipCreditNoteRecord
  ): Promise<void> {
    return this.delivery.downloadCreditNotePdf(creditNote);
  }

  resendInvoice(invoice: AdminSponsorshipInvoiceRecord): Promise<void> {
    return this.delivery.resendInvoice(invoice);
  }

  resendCreditNote(
    creditNote: AdminSponsorshipCreditNoteRecord
  ): Promise<void> {
    return this.delivery.resendCreditNote(creditNote);
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

  private messageFromError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : this.i18n.t('admin.messages.operation_admin_impossible');
  }
}
