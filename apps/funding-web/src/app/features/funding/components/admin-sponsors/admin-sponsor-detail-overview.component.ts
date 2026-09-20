import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  signal,
  output,
  viewChild
} from '@angular/core';

import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import type { AdminSponsorDetailOverviewView } from '../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsor-detail-overview',
  standalone: true,
  imports: [CommonModule, TranslatePipe, AdminDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      #details
      class="detail-body"
      tabindex="-1"
      [attr.aria-label]="'admin.legacy.vue_d_ensemble' | translate"
    >
      <div class="detail-card-grid">
        <article class="detail-card">
          <h3>{{ 'admin.legacy.entreprise_contact' | translate }}</h3>
          <dl>
            <div>
              <dt>{{ 'admin.legacy.nom_de_l_entreprise' | translate }}</dt>
              <dd>{{ overview().companyName }}</dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.nom_public' | translate }}</dt>
              <dd>{{ overview().publicNameLabel }}</dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.contact' | translate }}</dt>
              <dd>{{ overview().contactName }}</dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.courriel' | translate }}</dt>
              <dd>
                <a
                  *ngIf="overview().contactEmail; else emptyEmail"
                  [href]="'mailto:' + overview().contactEmail"
                  >{{ overview().contactEmail }}</a
                ><ng-template #emptyEmail>{{
                  'admin.legacy.non_fourni' | translate
                }}</ng-template>
              </dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.site_web' | translate }}</dt>
              <dd>
                <a
                  *ngIf="overview().websiteUrl; else emptyWebsite"
                  [href]="overview().websiteUrl"
                  target="_blank"
                  rel="noreferrer"
                  >{{ overview().websiteUrl }}</a
                ><ng-template #emptyWebsite>{{
                  'admin.legacy.non_fourni' | translate
                }}</ng-template>
              </dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.reference_publique' | translate }}</dt>
              <dd class="copy-line">
                <code>{{
                  overview().publicReference ||
                    ('admin.legacy.non_attribuee_175' | translate)
                }}</code
                ><button
                  type="button"
                  class="mini-action"
                  (click)="copyReference.emit()"
                  [disabled]="!overview().publicReference"
                >
                  {{ 'admin.legacy.copier' | translate }}
                </button>
              </dd>
            </div>
          </dl>
          <small class="inline-status" *ngIf="overview().copyMessage">{{
            overview().copyMessage
          }}</small>
        </article>

        <article class="detail-card">
          <h3>{{ 'admin.legacy.commandite' | translate }}</h3>
          <dl>
            <div>
              <dt>{{ 'admin.legacy.montant' | translate }}</dt>
              <dd>{{ overview().amountLabel }}</dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.niveau_tier' | translate }}</dt>
              <dd>
                <span [class]="overview().tierClass">{{
                  overview().tierLabel
                }}</span>
              </dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.avantages' | translate }}</dt>
              <dd>{{ overview().benefitsLabel }}</dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.paiement' | translate }}</dt>
              <dd>
                <span [class]="overview().paymentStatusClass">{{
                  overview().paymentStatusLabel
                }}</span>
              </dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.remboursement' | translate }}</dt>
              <dd>
                <span [class]="overview().refundStatusClass">{{
                  overview().refundStatusLabel
                }}</span>
              </dd>
            </div>
            <div *ngIf="overview().hasRefundWorkflow">
              <dt>{{ 'admin.legacy.suivi_remboursement' | translate }}</dt>
              <dd>{{ overview().refundWorkflowTimelineLabel }}</dd>
            </div>
            <div *ngIf="overview().refundId">
              <dt>{{ 'admin.legacy.refund_stripe' | translate }}</dt>
              <dd>{{ overview().refundId }}</dd>
            </div>
            <div>
              <dt>{{ 'admin.legacy.date_de_paiement' | translate }}</dt>
              <dd>{{ overview().paidAtLabel }}</dd>
            </div>
          </dl>
        </article>
      </div>

      <article class="detail-card" *ngIf="overview().sponsorMessage">
        <h3>{{ 'admin.legacy.message_du_commanditaire' | translate }}</h3>
        <p>{{ overview().sponsorMessage }}</p>
      </article>

      <article class="detail-card">
        <h3>{{ 'admin.legacy.note_interne' | translate }}</h3>
        <button type="button" (click)="noteOpen.set(true)">
          {{ 'admin.inspector.editNote' | translate }}
        </button>
        <openg7-admin-drawer
          [opened]="noteOpen()"
          [title]="'admin.inspector.note' | translate"
          [closeLabel]="'admin.inspector.close' | translate"
          [busy]="overview().reviewNoteSaving"
          (closed)="noteOpen.set(false)"
        >
          <label class="review-note-label"
            >{{
              'admin.legacy.note_visible_uniquement_pour_l_administration'
                | translate
            }}<textarea
              rows="5"
              maxlength="1000"
              [disabled]="overview().reviewNoteSaving"
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
                  ? ('admin.legacy.enregistrement' | translate)
                  : ('admin.legacy.enregistrer_la_note' | translate)
              }}
            </button>
          </div>
          <button
            type="button"
            [disabled]="overview().reviewNoteSaving"
            (click)="noteOpen.set(false)"
          >
            {{ 'admin.inspector.back' | translate }}
          </button>
        </openg7-admin-drawer>
      </article>
    </section>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css'
  ],
  styles: [
    `
      :host {
        display: block;
      }

      .detail-body:focus {
        outline: 3px solid var(--admin-focus);
        outline-offset: -3px;
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
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        color: var(--admin-text);
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
        border: 1px solid var(--admin-border);
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
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
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
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
      }

      .detail-card dl {
        display: grid;
        gap: 0.75rem;
        margin: 0;
      }

      dt {
        color: var(--admin-muted);
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
        color: var(--admin-muted);
      }

      .inline-status.is-dirty {
        color: var(--admin-warning);
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
        background: #3c3221;
        color: var(--admin-warning);
      }

      .payment-paid,
      .refund-completed {
        background: #193d32;
        color: var(--admin-success);
      }

      .payment-failed,
      .refund-failed {
        background: #422532;
        color: var(--admin-danger);
      }

      .refund-not-requested {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .refund-processing {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .tier-silver {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .tier-bronze {
        background: #3c3221;
        color: var(--admin-warning);
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
  private readonly details = viewChild<ElementRef<HTMLElement>>('details');
  readonly noteOpen = signal(false);
  readonly overview = input.required<AdminSponsorDetailOverviewView>();
  readonly copyReference = output<void>();
  readonly reviewNoteChange = output<string>();
  readonly saveReviewNote = output<void>();

  focusDetails(): void {
    const details = this.details()?.nativeElement;
    if (!details) return;
    details.focus({ preventScroll: true });
    details.scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  onReviewNoteInput(event: Event): void {
    this.reviewNoteChange.emit(this.valueFromEvent(event));
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLTextAreaElement | null)?.value ?? '';
  }
}
