import { ActivatedRoute, RouterLink } from '@angular/router';
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
  AdminSponsorshipInvoiceBackfillResult,
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoicesResponse
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type ResendState = 'idle' | 'confirming' | 'sending' | 'sent' | 'error';
type DownloadState = 'idle' | 'loading' | 'error';
type BackfillState = 'idle' | 'sending' | 'done' | 'error';

@Component({
  selector: 'openg7-admin-invoices-page',
  standalone: true,
  imports: [CommonModule, AdminLayoutComponent, TranslatePipe, RouterLink],
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
            <section
              class="invoice-list-panel"
              [attr.aria-label]="'admin.legacy.liste_factures' | translate"
            >
              <header>
                <div>
                  <span>{{
                    'admin.legacy.p0_resultat_s'
                      | translate: { p0: invoices().length }
                  }}</span>
                  <h2>{{ 'admin.legacy.factures_emises' | translate }}</h2>
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
                    {{ 'admin.legacy.avoir' | translate }}</span
                  >
                  <strong>
                    {{ formatMoney(invoice.total, invoice.currency) }}
                  </strong>
                </button>
              </div>

              <ng-template #emptyInvoices>
                <article class="empty-state">
                  <strong>{{
                    'admin.legacy.aucune_facture_commandite' | translate
                  }}</strong>
                  <span>
                    {{
                      'admin.legacy.les_factures_apparaissent_apres_un_paiement_de_commandite_traite_'
                        | translate
                    }}</span
                  >
                </article>
              </ng-template>
            </section>

            <section
              class="invoice-detail-panel"
              [attr.aria-label]="'admin.legacy.detail_facture' | translate"
              *ngIf="selectedInvoice() as invoice; else noInvoiceSelected"
            >
              <header class="detail-header">
                <div>
                  <span>{{ 'admin.legacy.facture' | translate }}</span>
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
                        ? ('admin.legacy.preparation_171' | translate)
                        : ('admin.legacy.telecharger_pdf' | translate)
                    }}
                  </button>
                  <button
                    type="button"
                    class="secondary-action"
                    (click)="
                      inspection.invoice(invoice.id, invoice.contribution_id)
                    "
                  >
                    {{ 'admin.inspector.previewInvoice' | translate }}
                  </button>
                  <span
                    class="download-message error"
                    *ngIf="invoicePdfMessage()"
                  >
                    {{ invoicePdfMessage() }}
                  </span>
                </div>
              </header>

              <section
                class="detail-grid"
                [attr.aria-label]="'admin.legacy.identite_facture' | translate"
              >
                <dl>
                  <div>
                    <dt>{{ 'admin.legacy.reference_publique' | translate }}</dt>
                    <dd>
                      {{
                        invoice.public_reference ||
                          ('admin.legacy.non_attribuee_175' | translate)
                      }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ 'admin.legacy.payee_le' | translate }}</dt>
                    <dd>{{ dateLabel(invoice.paid_at) }}</dd>
                  </div>
                  <div>
                    <dt>{{ 'admin.legacy.emise_le' | translate }}</dt>
                    <dd>{{ dateLabel(invoice.issued_at) }}</dd>
                  </div>
                </dl>

                <dl>
                  <div>
                    <dt>{{ 'admin.legacy.contact' | translate }}</dt>
                    <dd>{{ contactLabel(invoice) }}</dd>
                  </div>
                  <div>
                    <dt>{{ 'admin.legacy.courriel_facture' | translate }}</dt>
                    <dd>
                      {{
                        invoice.sponsor_contact_email ||
                          ('admin.legacy.absent' | translate)
                      }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ 'admin.legacy.site_web' | translate }}</dt>
                    <dd>
                      {{
                        invoice.sponsor_website_url ||
                          ('admin.legacy.absent' | translate)
                      }}
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                class="line-items"
                [attr.aria-label]="'admin.legacy.lignes_facture' | translate"
              >
                <header>
                  <span>{{ 'admin.legacy.lignes' | translate }}</span>
                  <strong>{{ invoice.currency }}</strong>
                </header>
                <div class="line-item" *ngFor="let line of invoice.line_items">
                  <span>{{ line.description }}</span>
                  <small>{{
                    'admin.legacy.p0_x_p1'
                      | translate
                        : {
                            p0: line.quantity,
                            p1: formatMoney(line.unit_amount, invoice.currency)
                          }
                  }}</small>
                  <strong>{{
                    formatMoney(line.total, invoice.currency)
                  }}</strong>
                </div>
                <dl class="totals">
                  <div>
                    <dt>{{ 'admin.legacy.sous_total' | translate }}</dt>
                    <dd>
                      {{ formatMoney(invoice.subtotal, invoice.currency) }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ invoice.tax_label }}</dt>
                    <dd>{{ formatMoney(invoice.tax, invoice.currency) }}</dd>
                  </div>
                  <div>
                    <dt>{{ 'admin.legacy.total_paye' | translate }}</dt>
                    <dd>{{ formatMoney(invoice.total, invoice.currency) }}</dd>
                  </div>
                </dl>
              </section>

              <section
                class="credit-notes-panel"
                *ngIf="invoice.credit_notes.length > 0"
                [attr.aria-label]="
                  'admin.legacy.avoirs_de_commandite' | translate
                "
              >
                <header>
                  <div>
                    <span>{{ 'admin.legacy.avoirs' | translate }}</span>
                    <h3>
                      {{ 'admin.legacy.remboursements_documentes' | translate }}
                    </h3>
                  </div>
                  <strong>{{
                    formatMoney(creditedTotal(invoice), invoice.currency)
                  }}</strong>
                </header>

                <article
                  class="credit-note-card"
                  data-og7="credit-note"
                  [attr.data-og7-id]="creditNote.id"
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
                      <dt>{{ 'admin.legacy.refund_stripe' | translate }}</dt>
                      <dd>{{ creditNote.stripe_refund_id }}</dd>
                    </div>
                    <div>
                      <dt>
                        {{ 'admin.legacy.dernier_destinataire' | translate }}
                      </dt>
                      <dd>
                        {{
                          creditNote.last_email_recipient ||
                            ('admin.legacy.absent' | translate)
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>{{ 'admin.legacy.dernier_envoi' | translate }}</dt>
                      <dd>{{ dateLabel(creditNote.last_email_sent_at) }}</dd>
                    </div>
                    <div *ngIf="creditNote.last_email_error">
                      <dt>{{ 'admin.legacy.erreur' | translate }}</dt>
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
                          ? ('admin.legacy.preparation_171' | translate)
                          : ('admin.legacy.telecharger_pdf' | translate)
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
                    {{ 'admin.legacy.destinataire_avoir' | translate
                    }}<input
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
                          ? ('admin.legacy.envoi_195' | translate)
                          : ('admin.legacy.renvoyer_avoir' | translate)
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
                    <a
                      *ngIf="resendMessageIds()[creditNote.id] as messageId"
                      routerLink="/admin/fundraiser/email-queue"
                      [queryParams]="{ messageId }"
                      data-og7="document-email-status"
                      [attr.data-og7-id]="creditNote.id"
                      >{{ 'admin.messages.suivre_courriel' | translate }}</a
                    >
                  </div>
                </article>
              </section>

              <section
                class="stripe-grid"
                [attr.aria-label]="'admin.legacy.references_stripe' | translate"
              >
                <dl>
                  <div>
                    <dt>{{ 'admin.legacy.checkout_session' | translate }}</dt>
                    <dd>{{ invoice.stripe_session_id }}</dd>
                  </div>
                  <div>
                    <dt>{{ 'admin.legacy.payment_intent' | translate }}</dt>
                    <dd>
                      {{
                        invoice.stripe_payment_intent_id ||
                          ('admin.legacy.absent' | translate)
                      }}
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                class="email-panel"
                [attr.aria-label]="'admin.legacy.renvoi_courriel' | translate"
              >
                <header>
                  <div>
                    <span>{{ 'admin.legacy.courriel' | translate }}</span>
                    <h3>{{ 'admin.legacy.renvoi_facture' | translate }}</h3>
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
                    <dt>
                      {{ 'admin.legacy.dernier_destinataire' | translate }}
                    </dt>
                    <dd>
                      {{
                        invoice.last_email_recipient ||
                          ('admin.legacy.absent' | translate)
                      }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ 'admin.legacy.dernier_envoi' | translate }}</dt>
                    <dd>{{ dateLabel(invoice.last_email_sent_at) }}</dd>
                  </div>
                  <div *ngIf="invoice.last_email_error">
                    <dt>{{ 'admin.legacy.erreur' | translate }}</dt>
                    <dd>{{ invoice.last_email_error }}</dd>
                  </div>
                </dl>

                <label>
                  {{ 'admin.legacy.destinataire' | translate
                  }}<input
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
                    {{
                      resendState() === 'sending'
                        ? ('admin.legacy.envoi_195' | translate)
                        : ('admin.legacy.renvoyer' | translate)
                    }}
                  </button>
                  <span
                    class="resend-message"
                    [class.error]="resendState() === 'error'"
                    [class.success]="resendState() === 'sent'"
                    *ngIf="resendMessage()"
                  >
                    {{ resendMessage() }}
                  </span>
                  <a
                    *ngIf="resendMessageIds()[invoice.id] as messageId"
                    routerLink="/admin/fundraiser/email-queue"
                    [queryParams]="{ messageId }"
                    data-og7="document-email-status"
                    [attr.data-og7-id]="invoice.id"
                    >{{ 'admin.messages.suivre_courriel' | translate }}</a
                  >
                </div>
              </section>

              <p class="invoice-note" *ngIf="invoice.notes">
                {{ invoice.notes }}
              </p>
            </section>

            <ng-template #noInvoiceSelected>
              <section class="invoice-detail-panel empty-detail">
                <strong>{{
                  'admin.legacy.aucune_facture_selectionnee' | translate
                }}</strong>
              </section>
            </ng-template>
          </section>
        </ng-container>
      </section>
    </openg7-admin-layout>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css'
  ],
  styles: [
    `
      :host {
        display: block;
      }

      .admin-content {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar {
        align-items: center;
        background: var(--admin-panel-raised);
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
        color: var(--admin-warning);
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
        background: var(--admin-panel-raised);
        border-radius: 0.4rem;
        color: var(--admin-text);
        font-weight: 900;
        min-height: 2.45rem;
        padding: 0 0.95rem;
      }

      .secondary-action {
        background: var(--admin-panel);
        border: 1px solid rgba(23, 32, 51, 0.18);
        border-radius: 0.4rem;
        color: var(--admin-text);
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
        background: var(--admin-panel-raised);
        border: 1px solid rgba(23, 32, 51, 0.1);
        border-radius: 0.45rem;
        color: var(--admin-muted);
        font-weight: 800;
        padding: 0.85rem 1rem;
      }

      .state-error {
        background: var(--admin-panel-raised);
        border-color: rgba(179, 38, 30, 0.22);
        color: var(--admin-danger);
      }

      .admin-summary-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }

      .admin-summary-grid article,
      .invoice-list-panel,
      .invoice-detail-panel {
        background: var(--admin-panel-raised);
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
        color: var(--admin-muted);
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
        background: var(--admin-panel);
        border: 1px solid rgba(23, 32, 51, 0.1);
        border-radius: 0.45rem;
        color: var(--admin-text);
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
        color: var(--admin-muted);
        grid-column: 1 / -1;
        font-weight: 800;
      }

      .invoice-meta {
        color: var(--admin-muted);
        font-size: 0.88rem;
        font-weight: 800;
      }

      .email-status {
        align-items: center;
        background: var(--admin-panel-raised);
        border-radius: 999px;
        color: var(--admin-muted);
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
        background: var(--admin-panel-raised);
        border-radius: 999px;
        color: var(--admin-muted);
        display: inline-flex;
        font-size: 0.72rem;
        font-weight: 950;
        justify-content: center;
        min-height: 1.65rem;
        padding: 0 0.6rem;
        white-space: nowrap;
      }

      .status-sent {
        background: var(--admin-panel-raised);
        color: var(--admin-success);
      }

      .status-failed {
        background: #422532;
        color: var(--admin-danger);
      }

      .status-queued {
        background: #3c3221;
        color: var(--admin-warning);
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
        color: var(--admin-muted);
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
        color: var(--admin-muted);
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
        background: var(--admin-panel);
        border: 1px solid rgba(23, 32, 51, 0.1);
        border-radius: 0.45rem;
        padding: 0.85rem;
      }

      .credit-notes-panel {
        border-color: rgba(23, 78, 166, 0.22);
      }

      .credit-note-card {
        background: var(--admin-panel);
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
        color: var(--admin-muted);
        font-size: 0.86rem;
        font-weight: 800;
      }

      .credit-note-meta {
        background: var(--admin-panel);
        border-radius: 0.35rem;
        padding: 0.7rem;
      }

      .line-item {
        grid-template-columns: minmax(0, 1fr) auto auto;
      }

      .line-item small {
        color: var(--admin-muted);
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
        color: var(--admin-text);
        font-size: 1rem;
      }

      .stripe-grid dd {
        font-family:
          ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
          'Liberation Mono', 'Courier New', monospace;
        font-size: 0.86rem;
      }

      .email-meta {
        background: var(--admin-panel-raised);
        border-radius: 0.4rem;
        padding: 0.75rem;
      }

      label {
        color: var(--admin-muted);
        display: grid;
        font-size: 0.8rem;
        font-weight: 900;
        gap: 0.35rem;
        text-transform: uppercase;
      }

      input {
        background: var(--admin-panel);
        border: 1px solid rgba(23, 32, 51, 0.16);
        border-radius: 0.35rem;
        color: var(--admin-text);
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
        color: var(--admin-muted);
        font-weight: 850;
      }

      .resend-message.success {
        color: var(--admin-success);
      }

      .resend-message.error {
        color: var(--admin-danger);
      }

      .download-message {
        color: var(--admin-muted);
        font-weight: 850;
      }

      .download-message.error {
        color: var(--admin-danger);
      }

      .invoice-note,
      .empty-state,
      .empty-detail {
        background: var(--admin-panel-raised);
        border-radius: 0.4rem;
        color: var(--admin-muted);
        display: grid;
        gap: 0.25rem;
        padding: 0.85rem;
      }

      .empty-state strong,
      .empty-detail strong {
        color: var(--admin-text);
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
        .admin-summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 620px) {
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
  readonly backfillState = signal<BackfillState>('idle');
  readonly backfillMessage = signal('');
  readonly resendState = signal<ResendState>('idle');
  readonly resendMessage = signal('');
  readonly resendEmail = signal('');
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
    this.destroy.onDestroy(() => this.loadGeneration++);
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((params) => {
        this.contributionId = params.get('contributionId') ?? undefined;
        this.data.set(null);
        this.selectedInvoiceId.set('');
        this.resendEmail.set('');
        this.resendState.set('idle');
        this.invoicePdfMessage.set('');
        this.backfillMessage.set('');
        void this.loadInvoices();
      });
  }

  async loadInvoices(): Promise<void> {
    const generation = ++this.loadGeneration;
    const token = this.adminToken() || this.admin.getSavedAdminToken();
    this.adminToken.set(token);
    this.state.set('loading');
    this.resendMessage.set('');

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
      this.resendEmail.set(nextInvoice?.sponsor_contact_email ?? '');
      if (nextInvoice) {
        this.ensureCreditNoteResendDrafts(nextInvoice);
      }
      this.state.set('ready');
    } catch (error) {
      if (generation !== this.loadGeneration) return;
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
        contributionId: this.contributionId
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
    if (['confirming', 'sending'].includes(this.resendState())) return;
    const invoice = this.selectedInvoice();
    const to = this.resendEmail().trim();
    if (!invoice || !to) {
      return;
    }

    this.resendState.set('confirming');
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.retryEmail'),
        `${invoice.invoice_number} → ${to}`
      ))
    ) {
      this.resendState.set('idle');
      return;
    }
    this.resendMessage.set('');
    this.resendState.set('sending');

    try {
      const pending = await this.resendRequest(invoice.id, to);
      const result = await this.admin.resendSponsorshipInvoice(
        this.adminToken(),
        {
          invoiceId: invoice.id,
          to,
          confirmation: invoice.id,
          requestId: pending.requestId
        }
      );

      this.completeResend(pending.key);
      if (result.messageId)
        this.resendMessageIds.update((ids) => ({
          ...ids,
          [invoice.id]: result.messageId!
        }));

      if (result.invoice) {
        this.replaceInvoice(result.invoice);
      }

      this.resendState.set('sent');
      this.resendMessage.set(
        result.sent
          ? this.i18n.t('admin.messages.facture_envoyee')
          : result.queued
            ? this.i18n.t('admin.messages.facture_remise_en_file')
            : this.i18n.t('admin.messages.demande_traitee')
      );
    } catch (error) {
      this.resendState.set('error');
      this.resendMessage.set(this.messageFromError(error));
    }
  }

  async resendCreditNote(
    creditNote: AdminSponsorshipCreditNoteRecord
  ): Promise<void> {
    if (
      ['confirming', 'sending'].includes(
        this.creditNoteResendStateFor(creditNote.id)
      )
    )
      return;
    const to = this.creditNoteResendEmail(creditNote).trim();
    if (!to) {
      return;
    }

    this.setCreditNoteResendState(creditNote.id, 'confirming');
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.retryEmail'),
        `${creditNote.credit_note_number} → ${to}`
      ))
    ) {
      this.setCreditNoteResendState(creditNote.id, 'idle');
      return;
    }
    this.setCreditNoteResendMessage(creditNote.id, '');
    this.setCreditNoteResendState(creditNote.id, 'sending');

    try {
      const pending = await this.resendRequest(creditNote.id, to);
      const result = await this.admin.resendSponsorshipCreditNote(
        this.adminToken(),
        {
          creditNoteId: creditNote.id,
          to,
          confirmation: creditNote.id,
          requestId: pending.requestId
        }
      );

      this.completeResend(pending.key);
      if (result.messageId)
        this.resendMessageIds.update((ids) => ({
          ...ids,
          [creditNote.id]: result.messageId!
        }));

      if (result.creditNote) {
        this.replaceCreditNote(result.creditNote);
      }

      this.setCreditNoteResendState(creditNote.id, 'sent');
      this.setCreditNoteResendMessage(
        creditNote.id,
        result.sent
          ? this.i18n.t('admin.messages.avoir_envoye')
          : result.queued
            ? this.i18n.t('admin.messages.avoir_remis_en_file')
            : this.i18n.t('admin.messages.demande_traitee')
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

  emailStatusLabel(status: string | null): string {
    switch (status) {
      case 'sent':
        return this.i18n.t('admin.messages.envoye');
      case 'failed':
        return this.i18n.t('admin.messages.echec');
      case 'sending':
        return this.i18n.t('admin.legacy.envoi');
      case 'queued':
        return this.i18n.t('admin.legacy.en_file');
      default:
        return this.i18n.t('admin.messages.jamais_envoye');
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
