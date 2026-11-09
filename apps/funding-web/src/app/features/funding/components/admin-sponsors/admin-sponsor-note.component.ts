import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import type { AdminSponsorNoteView } from '../../models/admin-sponsors-ui.models.js';

/** The existing private-note editor, available from the dossier's global toolbar. */
@Component({
  selector: 'openg7-admin-sponsor-note',
  standalone: true,
  imports: [CommonModule, TranslatePipe, AdminDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-drawer
      [opened]="noteOpen()"
      [title]="'admin.inspector.note' | translate"
      [closeLabel]="'admin.inspector.close' | translate"
      [busy]="view().reviewNoteSaving"
      (closed)="noteOpen.set(false)"
    >
      <div class="note-editor" data-og7="sponsor-note-editor">
        <div class="note-context">
          <div class="note-dossier">
            <span class="note-eyebrow">{{
              'admin.dossier.workspace.dossier' | translate
            }}</span>
            <strong>{{ view().companyName }}</strong>
            <span *ngIf="view().publicReference" class="note-reference">{{
              view().publicReference
            }}</span>
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
            [placeholder]="'admin.dossier.noteEditor.placeholder' | translate"
            [disabled]="disabled()"
            [value]="view().reviewNote"
            (input)="onReviewNoteInput($event)"
          ></textarea>
          <span
            id="sponsor-note-counter"
            class="note-counter"
            [class.is-near-limit]="view().reviewNote.length >= 900"
            >{{
              'admin.dossier.noteEditor.characters'
                | translate: { count: view().reviewNote.length, limit: 1000 }
            }}</span
          >
        </div>

        <div class="note-feedback" [class.is-dirty]="view().reviewNoteDirty">
          <span class="note-status" role="status" aria-live="polite">{{
            view().reviewNoteStateLabel
          }}</span>
          <small *ngIf="view().reviewNoteDirty && !view().reviewNoteSaving">{{
            'admin.dossier.noteEditor.saveHint' | translate
          }}</small>
        </div>

        <div class="note-actions">
          <button
            type="button"
            class="admin-button"
            [disabled]="view().reviewNoteSaving"
            (click)="noteOpen.set(false)"
          >
            {{ 'admin.dossier.noteEditor.close' | translate }}
          </button>
          <button
            type="button"
            class="admin-button admin-button--primary"
            [attr.aria-busy]="view().reviewNoteSaving"
            (click)="saveReviewNote.emit()"
            [disabled]="!view().reviewNoteDirty || disabled()"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
            {{
              view().reviewNoteSaving
                ? ('admin.legacy.enregistrement' | translate)
                : ('admin.legacy.enregistrer_la_note' | translate)
            }}
          </button>
        </div>
      </div>
    </openg7-admin-drawer>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-note-editor.css'
  ]
})
export class AdminSponsorNoteComponent {
  readonly sponsorshipId = input.required<string>();
  readonly view = input.required<AdminSponsorNoteView>();
  readonly disabled = input(false);
  readonly noteOpen = signal(false);
  readonly reviewNoteChange = output<string>();
  readonly saveReviewNote = output<void>();

  constructor() {
    effect(() => {
      this.sponsorshipId();
      this.noteOpen.set(false);
    });
  }

  openNote(): void {
    this.noteOpen.set(true);
  }

  onReviewNoteInput(event: Event): void {
    this.reviewNoteChange.emit(
      (event.target as HTMLTextAreaElement | null)?.value ?? ''
    );
  }
}
