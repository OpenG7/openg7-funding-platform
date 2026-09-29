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

        <article
          class="detail-card admin-focus-target"
          id="dossier-payment"
          tabindex="-1"
          aria-labelledby="dossier-payment-title"
        >
          <h3 id="dossier-payment-title">
            {{ 'admin.legacy.commandite' | translate }}
          </h3>
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

      <div class="detail-card-grid detail-notes">
        <article class="detail-card" *ngIf="overview().sponsorMessage">
          <h3>{{ 'admin.legacy.message_du_commanditaire' | translate }}</h3>
          <p>{{ overview().sponsorMessage }}</p>
        </article>

        <article class="detail-card" aria-labelledby="sponsor-note-card-title">
          <div class="note-card-heading">
            <h3 id="sponsor-note-card-title">
              {{ 'admin.legacy.note_interne' | translate }}
            </h3>
            <span *ngIf="overview().reviewNoteDirty" class="note-draft">{{
              'admin.dossier.noteEditor.unsaved' | translate
            }}</span>
          </div>
          <p
            *ngIf="overview().reviewNote.trim(); else emptyNote"
            class="note-preview"
          >
            {{ overview().reviewNote.trim() }}
          </p>
          <ng-template #emptyNote>
            <p class="note-empty">
              {{ 'admin.dossier.noteEditor.empty' | translate }}
            </p>
          </ng-template>
          <button
            type="button"
            class="admin-button note-open"
            (click)="noteOpen.set(true)"
          >
            {{
              (disabled() ? 'admin.inspector.note' : 'admin.inspector.editNote')
                | translate
            }}
          </button>
          <openg7-admin-drawer
            [opened]="noteOpen()"
            [title]="'admin.inspector.note' | translate"
            [closeLabel]="'admin.inspector.close' | translate"
            [busy]="overview().reviewNoteSaving"
            (closed)="noteOpen.set(false)"
          >
            <div class="note-editor" data-og7="sponsor-note-editor">
              <div class="note-context">
                <div class="note-dossier">
                  <span class="note-eyebrow">{{
                    'admin.dossier.workspace.dossier' | translate
                  }}</span>
                  <strong>{{ overview().companyName }}</strong>
                  <span
                    *ngIf="overview().publicReference"
                    class="note-reference"
                    >{{ overview().publicReference }}</span
                  >
                </div>
                <span class="note-private">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="5" y="10" width="14" height="11" rx="3" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
                  </svg>
                  {{ 'admin.dossier.noteEditor.private' | translate }}
                </span>
              </div>

              <p id="sponsor-note-privacy" class="note-privacy">
                {{
                  'admin.legacy.note_visible_uniquement_pour_l_administration'
                    | translate
                }}
              </p>

              <div class="note-field">
                <label for="sponsor-review-note">{{
                  'admin.dossier.noteEditor.label' | translate
                }}</label>
                <textarea
                  id="sponsor-review-note"
                  rows="8"
                  maxlength="1000"
                  aria-describedby="sponsor-note-privacy sponsor-note-counter"
                  [placeholder]="
                    'admin.dossier.noteEditor.placeholder' | translate
                  "
                  [disabled]="disabled()"
                  [value]="overview().reviewNote"
                  (input)="onReviewNoteInput($event)"
                ></textarea>
                <span
                  id="sponsor-note-counter"
                  class="note-counter"
                  [class.is-near-limit]="overview().reviewNote.length >= 900"
                  >{{
                    'admin.dossier.noteEditor.characters'
                      | translate
                        : { count: overview().reviewNote.length, limit: 1000 }
                  }}</span
                >
              </div>

              <div
                class="note-feedback"
                [class.is-dirty]="overview().reviewNoteDirty"
              >
                <span class="note-status" role="status" aria-live="polite">{{
                  overview().reviewNoteStateLabel
                }}</span>
                <small
                  *ngIf="
                    overview().reviewNoteDirty && !overview().reviewNoteSaving
                  "
                  >{{ 'admin.dossier.noteEditor.saveHint' | translate }}</small
                >
              </div>

              <div class="note-actions">
                <button
                  type="button"
                  class="admin-button"
                  [disabled]="overview().reviewNoteSaving"
                  (click)="noteOpen.set(false)"
                >
                  {{ 'admin.dossier.noteEditor.close' | translate }}
                </button>
                <button
                  type="button"
                  class="admin-button admin-button--primary"
                  [attr.aria-busy]="overview().reviewNoteSaving"
                  (click)="saveReviewNote.emit()"
                  [disabled]="!overview().reviewNoteDirty || disabled()"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                  {{
                    overview().reviewNoteSaving
                      ? ('admin.legacy.enregistrement' | translate)
                      : ('admin.legacy.enregistrer_la_note' | translate)
                  }}
                </button>
              </div>
            </div>
          </openg7-admin-drawer>
        </article>
      </div>
    </section>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-note-editor.css'
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

      .detail-notes > .detail-card {
        align-content: start;
        min-width: 0;
      }

      .detail-notes > .detail-card > p {
        margin: 0;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
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
  readonly disabled = input(false);
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
