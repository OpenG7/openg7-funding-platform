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
import type {
  AdminSponsorDetailOverviewView,
  SponsorDetailsTab
} from '../../models/admin-sponsors-ui.models.js';

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
      <article
        class="detail-card detail-summary admin-focus-target"
        id="dossier-payment"
        tabindex="-1"
        aria-labelledby="dossier-payment-title"
        data-og7="dossier-overview-summary"
      >
        <h3 id="dossier-payment-title">
          {{ 'admin.legacy.commandite' | translate }}
        </h3>
        <dl>
          <div>
            <dt>{{ 'admin.legacy.reference_publique' | translate }}</dt>
            <dd class="copy-line">
              <code>{{
                overview().publicReference ||
                  ('admin.legacy.non_attribuee_175' | translate)
              }}</code>
              <button
                type="button"
                class="mini-action"
                (click)="copyReference.emit()"
                [disabled]="!overview().publicReference"
              >
                {{ 'admin.legacy.copier' | translate }}
              </button>
            </dd>
          </div>
          <div *ngIf="showBenefits()">
            <dt>{{ 'admin.legacy.avantages' | translate }}</dt>
            <dd>{{ overview().benefitsLabel }}</dd>
          </div>
        </dl>
        <small
          class="inline-status"
          role="status"
          *ngIf="overview().copyMessage"
          >{{ overview().copyMessage }}</small
        >
        <p class="summary-help">
          {{ 'admin.dossier.overview.financeHint' | translate }}
        </p>
        <nav
          class="summary-links"
          [attr.aria-label]="'admin.dossier.workspace.dossier' | translate"
        >
          <button
            type="button"
            class="admin-button"
            data-og7="overview-open-profile"
            (click)="sectionRequested.emit('identity')"
          >
            {{ 'admin.dossier.overview.openProfile' | translate }}
          </button>
          <button
            type="button"
            class="admin-button"
            data-og7="overview-open-finances"
            (click)="sectionRequested.emit('billing')"
          >
            {{ 'admin.dossier.overview.openFinances' | translate }}
          </button>
        </nav>
      </article>

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
            (click)="openNote()"
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
    './admin-sponsor-note-editor.css',
    './admin-sponsor-detail-overview.component.css'
  ]
})
export class AdminSponsorDetailOverviewComponent {
  private readonly details = viewChild<ElementRef<HTMLElement>>('details');
  readonly noteOpen = signal(false);
  readonly overview = input.required<AdminSponsorDetailOverviewView>();
  readonly showBenefits = input(true);
  readonly disabled = input(false);
  readonly copyReference = output<void>();
  readonly sectionRequested = output<SponsorDetailsTab>();
  readonly reviewNoteChange = output<string>();
  readonly saveReviewNote = output<void>();

  openNote(): void {
    this.noteOpen.set(true);
  }

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
