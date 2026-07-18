import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type {
  AdminSponsorshipCreditNoteRecord,
  AdminSponsorshipInvoiceBackfillResult,
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoicesResponse
} from '@openg7/funding-core';

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type ResendState = 'idle' | 'sending' | 'sent' | 'error';
type DownloadState = 'idle' | 'loading' | 'error';
type BackfillState = 'idle' | 'sending' | 'done' | 'error';

@Component({
  selector: 'openg7-admin-invoices-page',
  standalone: true,
  imports: [CommonModule, AdminNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-shell">
      <openg7-admin-nav />

      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>Administration</span>
            <h1>Factures commandite</h1>
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
                  ? 'Generation...'
                  : 'Generer factures manquantes'
              }}
            </button>
            <button
              type="button"
              (click)="loadInvoices()"
              [disabled]="state() === 'loading'"
            >
              Actualiser
            </button>
          </nav>
        </header>

        <p class="state" *ngIf="state() === 'loading'" aria-live="polite">
          Chargement des factures...
        </p>
        <p
          class="state state-error"
          *ngIf="state() === 'error'"
          aria-live="polite"
        >
          Impossible de charger les factures. Verifiez DATABASE_URL et la
          migration 011/012.
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
          <section class="admin-summary-grid" aria-label="Resume factures">
            <article>
              <span>Factures</span>
              <strong>{{ response.summary.total_count }}</strong>
              <small>Commandites payees</small>
            </article>
            <article>
              <span>Total facture</span>
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
              <span>Total credite</span>
              <strong>
                {{
                  formatMoney(
                    response.summary.total_credited,
                    response.summary.currency
                  )
                }}
              </strong>
              <small>{{ response.summary.credit_note_count }} avoir(s)</small>
            </article>
            <article>
              <span>Courriels echoues</span>
              <strong>{{ response.summary.failed_email_count }}</strong>
              <small>Dernier statut facture</small>
            </article>
            <article>
              <span>Mis a jour</span>
              <strong>{{ shortDateLabel(response.last_updated_at) }}</strong>
              <small>Snapshot admin</small>
            </article>
          </section>

          <section class="invoices-board" aria-label="Factures admin">
            <section class="invoice-list-panel" aria-label="Liste factures">
              <header>
                <div>
                  <span>{{ invoices().length }} resultat(s)</span>
                  <h2>Factures emises</h2>
                </div>
              </header>

              <div
                class="invoice-list"
                *ngIf="invoices().length > 0; else emptyInvoices"
              >
                <button
                  type="button"
                  *ngFor="let invoice of invoices(); trackBy: trackByInvoice"
                  [class.selected]="invoice.id === selectedInvoiceId()"
                  (click)="selectInvoice(invoice)"
                >
                  <span class="invoice-number">
                    {{ invoice.invoice_number }}
                  </span>
                  <span class="invoice-name">{{ invoice.sponsor_name }}</span>
                  <span class="invoice-meta">
                    {{ dateLabel(invoice.paid_at || invoice.issued_at) }}
                  </span>
                  <span
                    class="email-status"
                    [class.status-sent]="invoice.last_email_status === 'sent'"
                    [class.status-failed]="
                      invoice.last_email_status === 'failed'
                    "
                    [class.status-queued]="
                      invoice.last_email_status === 'queued' ||
                      invoice.last_email_status === 'sending'
                    "
                  >
                    {{ emailStatusLabel(invoice.last_email_status) }}
                  </span>
                  <span
                    class="credit-status"
                    *ngIf="invoice.credit_notes.length > 0"
                  >
                    Avoir
                  </span>
                  <strong>
                    {{ formatMoney(invoice.total, invoice.currency) }}
                  </strong>
                </button>
              </div>

              <ng-template #emptyInvoices>
                <article class="empty-state">
                  <strong>Aucune facture commandite.</strong>
                  <span>
                    Les factures apparaissent apres un paiement de commandite
                    traite par Stripe.
                  </span>
                </article>
              </ng-template>
            </section>

            <section
              class="invoice-detail-panel"
              aria-label="Detail facture"
              *ngIf="selectedInvoice() as invoice; else noInvoiceSelected"
            >
              <header class="detail-header">
                <div>
                  <span>Facture</span>
                  <h2>{{ invoice.invoice_number }}</h2>
                  <p>{{ invoice.sponsor_name }}</p>
                </div>
                <div class="detail-actions">
                  <strong>{{
                    formatMoney(invoice.total, invoice.currency)
                  }}</strong>
                  <button
                    type="button"
                    class="secondary-action"
                    [disabled]="invoicePdfState() === 'loading'"
                    (click)="downloadInvoicePdf(invoice)"
                  >
                    {{
                      invoicePdfState() === 'loading'
                        ? 'Preparation...'
                        : 'Telecharger PDF'
                    }}
                  </button>
                  <span
                    class="download-message error"
                    *ngIf="invoicePdfMessage()"
                  >
                    {{ invoicePdfMessage() }}
                  </span>
                </div>
              </header>

              <section class="detail-grid" aria-label="Identite facture">
                <dl>
                  <div>
                    <dt>Reference publique</dt>
                    <dd>{{ invoice.public_reference || 'Non attribuee' }}</dd>
                  </div>
                  <div>
                    <dt>Payee le</dt>
                    <dd>{{ dateLabel(invoice.paid_at) }}</dd>
                  </div>
                  <div>
                    <dt>Emise le</dt>
                    <dd>{{ dateLabel(invoice.issued_at) }}</dd>
                  </div>
                </dl>

                <dl>
                  <div>
                    <dt>Contact</dt>
                    <dd>{{ contactLabel(invoice) }}</dd>
                  </div>
                  <div>
                    <dt>Courriel facture</dt>
                    <dd>{{ invoice.sponsor_contact_email || 'Absent' }}</dd>
                  </div>
                  <div>
                    <dt>Site web</dt>
                    <dd>{{ invoice.sponsor_website_url || 'Absent' }}</dd>
                  </div>
                </dl>
              </section>

              <section class="line-items" aria-label="Lignes facture">
                <header>
                  <span>Lignes</span>
                  <strong>{{ invoice.currency }}</strong>
                </header>
                <div class="line-item" *ngFor="let line of invoice.line_items">
                  <span>{{ line.description }}</span>
                  <small
                    >{{ line.quantity }} x
                    {{ formatMoney(line.unit_amount, invoice.currency) }}</small
                  >
                  <strong>{{
                    formatMoney(line.total, invoice.currency)
                  }}</strong>
                </div>
                <dl class="totals">
                  <div>
                    <dt>Sous-total</dt>
                    <dd>
                      {{ formatMoney(invoice.subtotal, invoice.currency) }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ invoice.tax_label }}</dt>
                    <dd>{{ formatMoney(invoice.tax, invoice.currency) }}</dd>
                  </div>
                  <div>
                    <dt>Total paye</dt>
                    <dd>{{ formatMoney(invoice.total, invoice.currency) }}</dd>
                  </div>
                </dl>
              </section>

              <section
                class="credit-notes-panel"
                *ngIf="invoice.credit_notes.length > 0"
                aria-label="Avoirs de commandite"
              >
                <header>
                  <div>
                    <span>Avoirs</span>
                    <h3>Remboursements documentes</h3>
                  </div>
                  <strong>{{
                    formatMoney(creditedTotal(invoice), invoice.currency)
                  }}</strong>
                </header>

                <article
                  class="credit-note-card"
                  *ngFor="
                    let creditNote of invoice.credit_notes;
                    trackBy: trackByCreditNote
                  "
                >
                  <div class="credit-note-title">
                    <div>
                      <strong>{{ creditNote.credit_note_number }}</strong>
                      <span>{{ dateLabel(creditNote.issued_at) }}</span>
                    </div>
                    <strong>{{
                      formatMoney(creditNote.total, creditNote.currency)
                    }}</strong>
                  </div>

                  <dl class="credit-note-meta">
                    <div>
                      <dt>Refund Stripe</dt>
                      <dd>{{ creditNote.stripe_refund_id }}</dd>
                    </div>
                    <div>
                      <dt>Dernier destinataire</dt>
                      <dd>{{ creditNote.last_email_recipient || 'Absent' }}</dd>
                    </div>
                    <div>
                      <dt>Dernier envoi</dt>
                      <dd>{{ dateLabel(creditNote.last_email_sent_at) }}</dd>
                    </div>
                    <div *ngIf="creditNote.last_email_error">
                      <dt>Erreur</dt>
                      <dd>{{ creditNote.last_email_error }}</dd>
                    </div>
                  </dl>

                  <span
                    class="email-status"
                    [class.status-sent]="
                      creditNote.last_email_status === 'sent'
                    "
                    [class.status-failed]="
                      creditNote.last_email_status === 'failed'
                    "
                    [class.status-queued]="
                      creditNote.last_email_status === 'queued' ||
                      creditNote.last_email_status === 'sending'
                    "
                  >
                    {{ emailStatusLabel(creditNote.last_email_status) }}
                  </span>

                  <div class="document-actions">
                    <button
                      type="button"
                      class="secondary-action"
                      [disabled]="
                        creditNotePdfStateFor(creditNote.id) === 'loading'
                      "
                      (click)="downloadCreditNotePdf(creditNote)"
                    >
                      {{
                        creditNotePdfStateFor(creditNote.id) === 'loading'
                          ? 'Preparation...'
                          : 'Telecharger PDF'
                      }}
                    </button>
                    <span
                      class="download-message error"
                      *ngIf="creditNotePdfMessageFor(creditNote.id)"
                    >
                      {{ creditNotePdfMessageFor(creditNote.id) }}
                    </span>
                  </div>

                  <label>
                    Destinataire avoir
                    <input
                      type="email"
                      autocomplete="email"
                      [value]="creditNoteResendEmail(creditNote)"
                      (input)="setCreditNoteResendEmail(creditNote.id, $event)"
                    />
                  </label>

                  <div class="resend-actions">
                    <button
                      type="button"
                      class="primary-action"
                      [disabled]="
                        creditNoteResendStateFor(creditNote.id) === 'sending' ||
                        !creditNoteResendEmail(creditNote).trim()
                      "
                      (click)="resendCreditNote(creditNote)"
                    >
                      {{
                        creditNoteResendStateFor(creditNote.id) === 'sending'
                          ? 'Envoi...'
                          : 'Renvoyer avoir'
                      }}
                    </button>
                    <span
                      class="resend-message"
                      [class.error]="
                        creditNoteResendStateFor(creditNote.id) === 'error'
                      "
                      [class.success]="
                        creditNoteResendStateFor(creditNote.id) === 'sent'
                      "
                      *ngIf="creditNoteResendMessageFor(creditNote.id)"
                    >
                      {{ creditNoteResendMessageFor(creditNote.id) }}
                    </span>
                  </div>
                </article>
              </section>

              <section class="stripe-grid" aria-label="References Stripe">
                <dl>
                  <div>
                    <dt>Checkout Session</dt>
                    <dd>{{ invoice.stripe_session_id }}</dd>
                  </div>
                  <div>
                    <dt>Payment Intent</dt>
                    <dd>{{ invoice.stripe_payment_intent_id || 'Absent' }}</dd>
                  </div>
                </dl>
              </section>

              <section class="email-panel" aria-label="Renvoi courriel">
                <header>
                  <div>
                    <span>Courriel</span>
                    <h3>Renvoi facture</h3>
                  </div>
                  <span
                    class="email-status"
                    [class.status-sent]="invoice.last_email_status === 'sent'"
                    [class.status-failed]="
                      invoice.last_email_status === 'failed'
                    "
                    [class.status-queued]="
                      invoice.last_email_status === 'queued' ||
                      invoice.last_email_status === 'sending'
                    "
                  >
                    {{ emailStatusLabel(invoice.last_email_status) }}
                  </span>
                </header>

                <dl class="email-meta">
                  <div>
                    <dt>Dernier destinataire</dt>
                    <dd>{{ invoice.last_email_recipient || 'Absent' }}</dd>
                  </div>
                  <div>
                    <dt>Dernier envoi</dt>
                    <dd>{{ dateLabel(invoice.last_email_sent_at) }}</dd>
                  </div>
                  <div *ngIf="invoice.last_email_error">
                    <dt>Erreur</dt>
                    <dd>{{ invoice.last_email_error }}</dd>
                  </div>
                </dl>

                <label>
                  Destinataire
                  <input
                    type="email"
                    autocomplete="email"
                    [value]="resendEmail()"
                    (input)="setResendEmail($event)"
                  />
                </label>

                <div class="resend-actions">
                  <button
                    type="button"
                    class="primary-action"
                    [disabled]="
                      resendState() === 'sending' || !resendEmail().trim()
                    "
                    (click)="resendInvoice()"
                  >
                    {{ resendState() === 'sending' ? 'Envoi...' : 'Renvoyer' }}
                  </button>
                  <span
                    class="resend-message"
                    [class.error]="resendState() === 'error'"
                    [class.success]="resendState() === 'sent'"
                    *ngIf="resendMessage()"
                  >
                    {{ resendMessage() }}
                  </span>
                </div>
              </section>

              <p class="invoice-note" *ngIf="invoice.notes">
                {{ invoice.notes }}
              </p>
            </section>

            <ng-template #noInvoiceSelected>
              <section class="invoice-detail-panel empty-detail">
                <strong>Aucune facture selectionnee.</strong>
              </section>
            </ng-template>
          </section>
        </ng-container>
      </section>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .admin-shell {
        background: #f3f0ea;
        color: #172033;
        display: grid;
        gap: 1.25rem;
        grid-template-columns: 16.5rem minmax(0, 1fr);
        min-height: 100vh;
        padding: 1.25rem;
      }

      .admin-content {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar {
        align-items: center;
        background: #fffaf1;
        border: 1px solid rgba(23, 32, 51, 0.1);
        border-radius: 0.5rem;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        padding: 1rem;
      }

      .admin-topbar div {
        display: grid;
        gap: 0.2rem;
      }

      .admin-topbar nav {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        justify-content: flex-end;
      }

      .admin-topbar span,
      .admin-summary-grid span,
      .invoice-list-panel header span,
      .detail-header span,
      .line-items header span,
      .credit-notes-panel header span,
      .email-panel header span {
        color: #736456;
        font-size: 0.73rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      h1 {
        font-size: clamp(1.45rem, 2vw, 2rem);
        line-height: 1.1;
      }

      h2 {
        font-size: 1.1rem;
      }

      h3 {
        font-size: 1rem;
      }

      button {
        border: 0;
        cursor: pointer;
        font: inherit;
      }

      .admin-topbar button,
      .primary-action {
        background: #172033;
        border-radius: 0.4rem;
        color: #fff;
        font-weight: 900;
        min-height: 2.45rem;
        padding: 0 0.95rem;
      }

      .secondary-action {
        background: #ffffff;
        border: 1px solid rgba(23, 32, 51, 0.18);
        border-radius: 0.4rem;
        color: #172033;
        font-weight: 900;
        min-height: 2.35rem;
        padding: 0 0.85rem;
      }

      .admin-topbar button:disabled,
      .primary-action:disabled,
      .secondary-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .state {
        background: #fffaf1;
        border: 1px solid rgba(23, 32, 51, 0.1);
        border-radius: 0.45rem;
        color: #5f6f90;
        font-weight: 800;
        padding: 0.85rem 1rem;
      }

      .state-error {
        background: #fff1f0;
        border-color: rgba(179, 38, 30, 0.22);
        color: #9c2f28;
      }

      .admin-summary-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }

      .admin-summary-grid article,
      .invoice-list-panel,
      .invoice-detail-panel {
        background: #fffaf1;
        border: 1px solid rgba(23, 32, 51, 0.1);
        border-radius: 0.5rem;
        box-shadow: 0 0.8rem 1.8rem rgba(23, 32, 51, 0.06);
      }

      .admin-summary-grid article {
        display: grid;
        gap: 0.25rem;
        min-height: 6.6rem;
        padding: 1rem;
      }

      .admin-summary-grid strong {
        font-size: 1.55rem;
        line-height: 1.1;
      }

      .admin-summary-grid small {
        color: #6f7a8e;
        font-weight: 800;
      }

      .invoices-board {
        align-items: start;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(18rem, 0.95fr) minmax(0, 1.45fr);
      }

      .invoice-list-panel,
      .invoice-detail-panel {
        min-width: 0;
        padding: 1rem;
      }

      .invoice-list-panel {
        display: grid;
        gap: 0.85rem;
      }

      .invoice-list-panel header,
      .detail-header,
      .line-items header,
      .credit-notes-panel header,
      .email-panel header {
        align-items: start;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .invoice-list {
        display: grid;
        gap: 0.5rem;
      }

      .invoice-list button {
        background: #ffffff;
        border: 1px solid rgba(23, 32, 51, 0.1);
        border-radius: 0.45rem;
        color: #172033;
        display: grid;
        gap: 0.25rem 0.75rem;
        grid-template-columns: minmax(0, 1fr) auto;
        min-height: 5.4rem;
        padding: 0.8rem;
        text-align: left;
      }

      .invoice-list button:hover,
      .invoice-list button.selected {
        border-color: rgba(184, 130, 36, 0.55);
        box-shadow: inset 0.25rem 0 0 #b98224;
      }

      .invoice-number,
      .invoice-name,
      .invoice-meta {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .invoice-number {
        font-weight: 950;
      }

      .invoice-name {
        color: #354159;
        grid-column: 1 / -1;
        font-weight: 800;
      }

      .invoice-meta {
        color: #6f7a8e;
        font-size: 0.88rem;
        font-weight: 800;
      }

      .email-status {
        align-items: center;
        background: #edf1f7;
        border-radius: 999px;
        color: #4d5d78;
        display: inline-flex;
        font-size: 0.72rem;
        font-weight: 950;
        justify-content: center;
        min-height: 1.65rem;
        padding: 0 0.6rem;
        white-space: nowrap;
      }

      .credit-status {
        align-items: center;
        background: #e8f1ff;
        border-radius: 999px;
        color: #174ea6;
        display: inline-flex;
        font-size: 0.72rem;
        font-weight: 950;
        justify-content: center;
        min-height: 1.65rem;
        padding: 0 0.6rem;
        white-space: nowrap;
      }

      .status-sent {
        background: #e4f4e7;
        color: #236b34;
      }

      .status-failed {
        background: #ffe7e4;
        color: #9c2f28;
      }

      .status-queued {
        background: #fff0d7;
        color: #7a4f09;
      }

      .invoice-detail-panel {
        display: grid;
        gap: 1rem;
      }

      .detail-header {
        border-bottom: 1px solid rgba(23, 32, 51, 0.1);
        padding-bottom: 1rem;
      }

      .detail-header p {
        color: #4d5d78;
        font-weight: 800;
        margin-top: 0.2rem;
      }

      .detail-actions {
        align-items: end;
        display: grid;
        gap: 0.45rem;
        justify-items: end;
      }

      .detail-actions > strong {
        font-size: 1.4rem;
        white-space: nowrap;
      }

      .detail-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      dl,
      .line-items,
      .credit-notes-panel,
      .email-panel {
        display: grid;
        gap: 0.65rem;
        margin: 0;
      }

      dl div,
      .line-item {
        align-items: start;
        border-bottom: 1px solid rgba(23, 32, 51, 0.08);
        display: grid;
        gap: 0.35rem;
        grid-template-columns: minmax(8rem, 0.75fr) minmax(0, 1fr);
        padding-bottom: 0.65rem;
      }

      dt {
        color: #6f7a8e;
        font-size: 0.78rem;
        font-weight: 900;
        text-transform: uppercase;
      }

      dd {
        font-weight: 850;
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .line-items,
      .credit-notes-panel,
      .email-panel {
        background: #ffffff;
        border: 1px solid rgba(23, 32, 51, 0.1);
        border-radius: 0.45rem;
        padding: 0.85rem;
      }

      .credit-notes-panel {
        border-color: rgba(23, 78, 166, 0.22);
      }

      .credit-note-card {
        background: #f7faff;
        border: 1px solid rgba(23, 78, 166, 0.16);
        border-radius: 0.4rem;
        display: grid;
        gap: 0.7rem;
        padding: 0.75rem;
      }

      .credit-note-title {
        align-items: start;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .credit-note-title div {
        display: grid;
        gap: 0.2rem;
      }

      .credit-note-title span {
        color: #6f7a8e;
        font-size: 0.86rem;
        font-weight: 800;
      }

      .credit-note-meta {
        background: #ffffff;
        border-radius: 0.35rem;
        padding: 0.7rem;
      }

      .line-item {
        grid-template-columns: minmax(0, 1fr) auto auto;
      }

      .line-item small {
        color: #6f7a8e;
        font-weight: 800;
        white-space: nowrap;
      }

      .totals {
        margin-top: 0.2rem;
      }

      .totals div:last-child {
        border-bottom: 0;
      }

      .totals div:last-child dt,
      .totals div:last-child dd {
        color: #172033;
        font-size: 1rem;
      }

      .stripe-grid dd {
        font-family:
          ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
          'Liberation Mono', 'Courier New', monospace;
        font-size: 0.86rem;
      }

      .email-meta {
        background: #f8f5ee;
        border-radius: 0.4rem;
        padding: 0.75rem;
      }

      label {
        color: #6f7a8e;
        display: grid;
        font-size: 0.8rem;
        font-weight: 900;
        gap: 0.35rem;
        text-transform: uppercase;
      }

      input {
        background: #fff;
        border: 1px solid rgba(23, 32, 51, 0.16);
        border-radius: 0.35rem;
        color: #172033;
        font: inherit;
        min-height: 2.5rem;
        padding: 0 0.75rem;
        text-transform: none;
      }

      .resend-actions {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .document-actions {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
      }

      .resend-message {
        color: #4d5d78;
        font-weight: 850;
      }

      .resend-message.success {
        color: #236b34;
      }

      .resend-message.error {
        color: #9c2f28;
      }

      .download-message {
        color: #4d5d78;
        font-weight: 850;
      }

      .download-message.error {
        color: #9c2f28;
      }

      .invoice-note,
      .empty-state,
      .empty-detail {
        background: #f8f5ee;
        border-radius: 0.4rem;
        color: #4d5d78;
        display: grid;
        gap: 0.25rem;
        padding: 0.85rem;
      }

      .empty-state strong,
      .empty-detail strong {
        color: #172033;
      }

      @media (max-width: 1080px) {
        .admin-summary-grid,
        .invoices-board,
        .detail-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .invoices-board,
        .detail-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 860px) {
        .admin-shell {
          grid-template-columns: 1fr;
        }

        .admin-summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 620px) {
        .admin-shell {
          padding: 0.75rem;
        }

        .admin-topbar,
        .detail-header,
        .detail-actions,
        .line-items header,
        .credit-notes-panel header,
        .credit-note-title,
        .email-panel header {
          align-items: stretch;
          flex-direction: column;
        }

        .admin-summary-grid {
          grid-template-columns: 1fr;
        }

        .invoice-list button,
        dl div,
        .line-item {
          grid-template-columns: 1fr;
        }

        .detail-actions {
          align-items: stretch;
          justify-items: stretch;
        }

        .detail-actions > strong,
        .line-item small,
        .email-status,
        .credit-status {
          white-space: normal;
        }
      }
    `
  ]
})
export class AdminInvoicesPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);

  readonly adminToken = signal('');
  readonly state = signal<LoadState>('idle');
  readonly backfillState = signal<BackfillState>('idle');
  readonly backfillMessage = signal('');
  readonly resendState = signal<ResendState>('idle');
  readonly resendMessage = signal('');
  readonly resendEmail = signal('');
  readonly invoicePdfState = signal<DownloadState>('idle');
  readonly invoicePdfMessage = signal('');
  readonly creditNoteResendEmails = signal<Record<string, string>>({});
  readonly creditNoteResendStates = signal<Record<string, ResendState>>({});
  readonly creditNoteResendMessages = signal<Record<string, string>>({});
  readonly creditNotePdfStates = signal<Record<string, DownloadState>>({});
  readonly creditNotePdfMessages = signal<Record<string, string>>({});
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

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    void this.loadInvoices();
  }

  async loadInvoices(): Promise<void> {
    const token = this.adminToken() || this.admin.getSavedAdminToken();
    this.adminToken.set(token);
    this.state.set('loading');
    this.resendMessage.set('');

    try {
      const response = await this.admin.getSponsorshipInvoices(token);
      this.data.set(response);
      const selectedStillExists = response.invoices.some(
        (invoice) => invoice.id === this.selectedInvoiceId()
      );
      const nextInvoice = selectedStillExists
        ? this.selectedInvoice()
        : (response.invoices[0] ?? null);
      this.selectedInvoiceId.set(nextInvoice?.id ?? '');
      this.resendEmail.set(nextInvoice?.sponsor_contact_email ?? '');
      if (nextInvoice) {
        this.ensureCreditNoteResendDrafts(nextInvoice);
      }
      this.state.set('ready');
    } catch (error) {
      this.state.set('error');
      this.resendMessage.set(this.messageFromError(error));
    }
  }

  selectInvoice(invoice: AdminSponsorshipInvoiceRecord): void {
    this.selectedInvoiceId.set(invoice.id);
    this.resendEmail.set(invoice.sponsor_contact_email ?? '');
    this.ensureCreditNoteResendDrafts(invoice);
    this.resendState.set('idle');
    this.resendMessage.set('');
    this.invoicePdfState.set('idle');
    this.invoicePdfMessage.set('');
  }

  setResendEmail(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.resendEmail.set(input.value);
  }

  async backfillInvoices(): Promise<void> {
    const token = this.adminToken() || this.admin.getSavedAdminToken();
    this.adminToken.set(token);
    this.backfillState.set('sending');
    this.backfillMessage.set('');

    try {
      const result = await this.admin.backfillSponsorshipInvoices(token, {
        limit: 250
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

  setCreditNoteResendEmail(id: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.creditNoteResendEmails.update((emails) => ({
      ...emails,
      [id]: input.value
    }));
  }

  creditNoteResendStateFor(id: string): ResendState {
    return this.creditNoteResendStates()[id] ?? 'idle';
  }

  creditNoteResendMessageFor(id: string): string {
    return this.creditNoteResendMessages()[id] ?? '';
  }

  creditNotePdfStateFor(id: string): DownloadState {
    return this.creditNotePdfStates()[id] ?? 'idle';
  }

  creditNotePdfMessageFor(id: string): string {
    return this.creditNotePdfMessages()[id] ?? '';
  }

  async downloadInvoicePdf(
    invoice: AdminSponsorshipInvoiceRecord
  ): Promise<void> {
    this.invoicePdfState.set('loading');
    this.invoicePdfMessage.set('');

    try {
      const blob = await this.admin.getSponsorshipInvoicePdf(
        this.adminToken(),
        invoice.id
      );
      this.saveBlob(blob, this.pdfFilename(invoice.invoice_number));
      this.invoicePdfState.set('idle');
    } catch (error) {
      this.invoicePdfState.set('error');
      this.invoicePdfMessage.set(this.messageFromError(error));
    }
  }

  async downloadCreditNotePdf(
    creditNote: AdminSponsorshipCreditNoteRecord
  ): Promise<void> {
    this.setCreditNotePdfState(creditNote.id, 'loading');
    this.setCreditNotePdfMessage(creditNote.id, '');

    try {
      const blob = await this.admin.getSponsorshipCreditNotePdf(
        this.adminToken(),
        creditNote.id
      );
      this.saveBlob(blob, this.pdfFilename(creditNote.credit_note_number));
      this.setCreditNotePdfState(creditNote.id, 'idle');
    } catch (error) {
      this.setCreditNotePdfState(creditNote.id, 'error');
      this.setCreditNotePdfMessage(creditNote.id, this.messageFromError(error));
    }
  }

  async resendInvoice(): Promise<void> {
    const invoice = this.selectedInvoice();
    const to = this.resendEmail().trim();
    if (!invoice || !to) {
      return;
    }

    this.resendState.set('sending');
    this.resendMessage.set('');

    try {
      const result = await this.admin.resendSponsorshipInvoice(
        this.adminToken(),
        {
          invoiceId: invoice.id,
          to
        }
      );

      if (result.invoice) {
        this.replaceInvoice(result.invoice);
      }

      this.resendState.set('sent');
      this.resendMessage.set(
        result.sent
          ? 'Facture envoyee.'
          : result.queued
            ? 'Facture remise en file.'
            : 'Demande traitee.'
      );
    } catch (error) {
      this.resendState.set('error');
      this.resendMessage.set(this.messageFromError(error));
    }
  }

  async resendCreditNote(
    creditNote: AdminSponsorshipCreditNoteRecord
  ): Promise<void> {
    const to = this.creditNoteResendEmail(creditNote).trim();
    if (!to) {
      return;
    }

    this.setCreditNoteResendState(creditNote.id, 'sending');
    this.setCreditNoteResendMessage(creditNote.id, '');

    try {
      const result = await this.admin.resendSponsorshipCreditNote(
        this.adminToken(),
        {
          creditNoteId: creditNote.id,
          to
        }
      );

      if (result.creditNote) {
        this.replaceCreditNote(result.creditNote);
      }

      this.setCreditNoteResendState(creditNote.id, 'sent');
      this.setCreditNoteResendMessage(
        creditNote.id,
        result.sent
          ? 'Avoir envoye.'
          : result.queued
            ? 'Avoir remis en file.'
            : 'Demande traitee.'
      );
    } catch (error) {
      this.setCreditNoteResendState(creditNote.id, 'error');
      this.setCreditNoteResendMessage(
        creditNote.id,
        this.messageFromError(error)
      );
    }
  }

  trackByInvoice(
    _index: number,
    invoice: AdminSponsorshipInvoiceRecord
  ): string {
    return invoice.id;
  }

  trackByCreditNote(
    _index: number,
    creditNote: AdminSponsorshipCreditNoteRecord
  ): string {
    return creditNote.id;
  }

  creditedTotal(invoice: AdminSponsorshipInvoiceRecord): number {
    return invoice.credit_notes.reduce(
      (total, creditNote) => total + creditNote.total,
      0
    );
  }

  formatMoney(value: number, currency: string): string {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: currency || 'CAD'
    }).format(value);
  }

  dateLabel(value: string | null): string {
    if (!value) {
      return 'Absent';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  shortDateLabel(value: string | null): string {
    if (!value) {
      return 'Absent';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium'
    }).format(date);
  }

  emailStatusLabel(status: string | null): string {
    switch (status) {
      case 'sent':
        return 'Envoye';
      case 'failed':
        return 'Echec';
      case 'sending':
        return 'Envoi';
      case 'queued':
        return 'En file';
      default:
        return 'Jamais envoye';
    }
  }

  contactLabel(invoice: AdminSponsorshipInvoiceRecord): string {
    return invoice.sponsor_contact_name || invoice.sponsor_name;
  }

  private replaceInvoice(invoice: AdminSponsorshipInvoiceRecord): void {
    const current = this.data();
    if (!current) {
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

  private setCreditNotePdfState(id: string, state: DownloadState): void {
    this.creditNotePdfStates.update((states) => ({
      ...states,
      [id]: state
    }));
  }

  private setCreditNotePdfMessage(id: string, message: string): void {
    this.creditNotePdfMessages.update((messages) => ({
      ...messages,
      [id]: message
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
      return 'Aucune commandite payee admissible a facturer.';
    }

    if (result.missing_count === 0) {
      return `Backfill termine: aucune facture manquante, ${result.skipped_count} deja presente(s).`;
    }

    const remaining =
      result.remaining_count > 0
        ? ` ${result.remaining_count} restante(s): relancez le backfill.`
        : '';

    return `Backfill termine: ${result.created_count} facture(s) creee(s), ${result.skipped_count} deja presente(s), ${result.failed_count} erreur(s).${remaining}`;
  }

  private messageFromError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Operation admin impossible.';
  }
}
