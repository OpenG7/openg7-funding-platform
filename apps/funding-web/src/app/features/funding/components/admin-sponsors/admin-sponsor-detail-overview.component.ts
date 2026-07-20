import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { AdminSponsorDetailOverviewView } from '../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsor-detail-overview',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="detail-body" aria-label="Vue d'ensemble">
      <div class="detail-card-grid">
        <article class="detail-card">
          <h3>Entreprise & contact</h3>
          <dl>
            <div>
              <dt>Nom de l'entreprise</dt>
              <dd>{{ overview().companyName }}</dd>
            </div>
            <div>
              <dt>Nom public</dt>
              <dd>{{ overview().publicNameLabel }}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{{ overview().contactName }}</dd>
            </div>
            <div>
              <dt>Courriel</dt>
              <dd>
                <a
                  *ngIf="overview().contactEmail; else emptyEmail"
                  [href]="'mailto:' + overview().contactEmail"
                  >{{ overview().contactEmail }}</a
                ><ng-template #emptyEmail>Non fourni</ng-template>
              </dd>
            </div>
            <div>
              <dt>Site web</dt>
              <dd>
                <a
                  *ngIf="overview().websiteUrl; else emptyWebsite"
                  [href]="overview().websiteUrl"
                  target="_blank"
                  rel="noreferrer"
                  >{{ overview().websiteUrl }}</a
                ><ng-template #emptyWebsite>Non fourni</ng-template>
              </dd>
            </div>
            <div>
              <dt>Reference publique</dt>
              <dd class="copy-line">
                <code>{{ overview().publicReference || 'Non attribuee' }}</code
                ><button
                  type="button"
                  class="mini-action"
                  (click)="copyReference.emit()"
                  [disabled]="!overview().publicReference"
                >
                  Copier
                </button>
              </dd>
            </div>
          </dl>
          <small class="inline-status" *ngIf="overview().copyMessage">{{
            overview().copyMessage
          }}</small>
        </article>

        <article class="detail-card">
          <h3>Commandite</h3>
          <dl>
            <div>
              <dt>Montant</dt>
              <dd>{{ overview().amountLabel }}</dd>
            </div>
            <div>
              <dt>Niveau / tier</dt>
              <dd>
                <span [class]="overview().tierClass">{{
                  overview().tierLabel
                }}</span>
              </dd>
            </div>
            <div>
              <dt>Avantages</dt>
              <dd>{{ overview().benefitsLabel }}</dd>
            </div>
            <div>
              <dt>Paiement</dt>
              <dd>
                <span [class]="overview().paymentStatusClass">{{
                  overview().paymentStatusLabel
                }}</span>
              </dd>
            </div>
            <div>
              <dt>Remboursement</dt>
              <dd>
                <span [class]="overview().refundStatusClass">{{
                  overview().refundStatusLabel
                }}</span>
              </dd>
            </div>
            <div *ngIf="overview().hasRefundWorkflow">
              <dt>Suivi remboursement</dt>
              <dd>{{ overview().refundWorkflowTimelineLabel }}</dd>
            </div>
            <div *ngIf="overview().refundId">
              <dt>Refund Stripe</dt>
              <dd>{{ overview().refundId }}</dd>
            </div>
            <div>
              <dt>Date de paiement</dt>
              <dd>{{ overview().paidAtLabel }}</dd>
            </div>
          </dl>
        </article>
      </div>

      <article class="detail-card" *ngIf="overview().sponsorMessage">
        <h3>Message du commanditaire</h3>
        <p>{{ overview().sponsorMessage }}</p>
      </article>

      <article class="detail-card">
        <h3>Note interne</h3>
        <label class="review-note-label"
          >Note visible uniquement pour l'administration.<textarea
            rows="5"
            maxlength="1000"
            [value]="overview().reviewNote"
            (input)="onReviewNoteInput($event)"
          ></textarea>
        </label>
        <div class="form-footer">
          <span
            class="inline-status"
            [class.is-dirty]="overview().reviewNoteDirty"
            aria-live="polite"
            >{{ overview().reviewNoteStateLabel }}</span
          ><button
            type="button"
            class="secondary-action"
            (click)="saveReviewNote.emit()"
            [disabled]="
              !overview().reviewNoteDirty || overview().reviewNoteSaving
            "
          >
            {{
              overview().reviewNoteSaving
                ? 'Enregistrement...'
                : 'Enregistrer la note'
            }}
          </button>
        </div>
      </article>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      button,
      input,
      select,
      textarea {
        font: inherit;
      }

      button:focus-visible,
      a:focus-visible,
      textarea:focus-visible {
        outline: 3px solid rgba(37, 99, 235, 0.28);
        outline-offset: 2px;
      }

      .secondary-action,
      .mini-action {
        align-items: center;
        background: #fff;
        border: 1px solid #cfd8e6;
        border-radius: 0.4rem;
        color: #172033;
        cursor: pointer;
        display: inline-flex;
        font-weight: 900;
        justify-content: center;
        min-height: 2.5rem;
        padding: 0 0.85rem;
        text-decoration: none;
      }

      .secondary-action:disabled,
      .mini-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      textarea {
        border: 1px solid #cdd6e3;
        border-radius: 0.35rem;
        padding: 0.65rem 0.75rem;
        resize: vertical;
      }

      .detail-body {
        display: grid;
        gap: 0.9rem;
        overflow: auto;
        padding: 1rem;
      }

      .detail-card {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.5rem;
        display: grid;
        gap: 0.85rem;
        padding: 1rem;
      }

      .detail-card h3 {
        margin: 0;
      }

      .detail-card-grid {
        display: grid;
        gap: 0.9rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .detail-card dl {
        display: grid;
        gap: 0.75rem;
        margin: 0;
      }

      dt {
        color: #667085;
        font-size: 0.76rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      dd {
        margin: 0.15rem 0 0;
        overflow-wrap: anywhere;
      }

      .copy-line {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .inline-status {
        color: #667085;
      }

      .inline-status.is-dirty {
        color: #a86f16;
        font-weight: 900;
      }

      .review-note-label {
        display: grid;
        font-size: 0.84rem;
        font-weight: 800;
        gap: 0.35rem;
      }

      .form-footer {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .tier-badge,
      .payment-badge,
      .refund-badge {
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.72rem;
        font-weight: 900;
        padding: 0.25rem 0.55rem;
        width: max-content;
      }

      .payment-pending,
      .refund-requested,
      .tier-gold {
        background: #fff2cf;
        color: #8a5a00;
      }

      .payment-paid,
      .refund-completed {
        background: #dff7e8;
        color: #176236;
      }

      .payment-failed,
      .refund-failed {
        background: #ffe0e5;
        color: #9f1d2f;
      }

      .refund-not-requested {
        background: #eef1f5;
        color: #667085;
      }

      .refund-processing {
        background: #e8f1ff;
        color: #174ea6;
      }

      .tier-silver {
        background: #eef2f7;
        color: #38425a;
      }

      .tier-bronze {
        background: #fff0e5;
        color: #9a4d13;
      }

      @media (max-width: 860px) {
        .detail-card-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class AdminSponsorDetailOverviewComponent {
  readonly overview = input.required<AdminSponsorDetailOverviewView>();
  readonly copyReference = output<void>();
  readonly reviewNoteChange = output<string>();
  readonly saveReviewNote = output<void>();

  onReviewNoteInput(event: Event): void {
    this.reviewNoteChange.emit(this.valueFromEvent(event));
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLTextAreaElement | null)?.value ?? '';
  }
}
