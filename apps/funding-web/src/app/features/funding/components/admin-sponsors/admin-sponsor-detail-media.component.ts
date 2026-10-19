import { TranslatePipe } from '@ngx-translate/core';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';

import type { AdminSponsorDetailIdentityView } from '../../models/admin-sponsors-ui.models.js';
import { AdminSponsorMediaPreferenceComponent } from '../sponsor-media-usage/admin-sponsor-media-preference.component.js';
import { MediaReviewWorkspaceComponent } from '../media-review/media-review-workspace.component.js';

import { AdminSponsorLogoPanelComponent } from './detail-media/admin-sponsor-logo-panel.component.js';

@Component({
  selector: 'openg7-admin-sponsor-detail-media',
  standalone: true,
  imports: [
    TranslatePipe,
    AdminSponsorLogoPanelComponent,
    MediaReviewWorkspaceComponent,
    AdminSponsorMediaPreferenceComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="detail-body admin-focus-target"
      id="dossier-media"
      data-og7="dossier-media"
      tabindex="-1"
      role="group"
      aria-labelledby="dossier-media-title"
    >
      <header class="media-summary" data-og7="dossier-media-summary">
        <div>
          <h3 id="dossier-media-title" class="section-title">
            {{ 'admin.dossier.media.sectionTitle' | translate }}
          </h3>
          <p class="muted-copy" aria-live="polite">
            @if (!identity().contributionId) {
              {{ 'admin.dossier.media.noGallery' | translate }}
            } @else if (summaryLoading()) {
              {{ 'admin.dossier.media.summaryLoading' | translate }}
            } @else if (summaryUnavailable()) {
              {{ 'admin.dossier.media.summaryUnavailable' | translate }}
            } @else if (mediaCounts(); as counts) {
              <span data-og7="dossier-media-file-count">{{
                'admin.dossier.media.fileCount'
                  | translate: { count: counts.all }
              }}</span>
              <span aria-hidden="true"> · </span>
              <span data-og7="dossier-media-blocked-count">{{
                'admin.dossier.media.blockedCount'
                  | translate: { count: counts.blocked }
              }}</span>
            } @else {
              {{ 'admin.dossier.media.summaryLoading' | translate }}
            }
          </p>
        </div>
        @if (identity().contributionId) {
          <button
            type="button"
            class="admin-button"
            data-og7="dossier-media-open-gallery"
            (click)="focusGallery()"
          >
            {{ 'admin.dossier.media.openGallery' | translate }}
          </button>
        }
      </header>
      <details>
        <summary class="logo-summary">
          @if (identity().logoPreviewSource) {
            <img
              class="logo-thumbnail"
              [src]="identity().logoPreviewSource"
              alt=""
            />
          }
          {{ 'admin.legacy.logo_actuel' | translate }}
          @if (!identity().logoPreviewSource && !identity().logoUrl) {
            <span class="muted-copy">{{
              'admin.legacy.aucun_logo_disponible' | translate
            }}</span>
          }
        </summary>
        <openg7-admin-sponsor-logo-panel
          [identity]="identity()"
          [disabled]="true"
          [hideControls]="true"
        />
      </details>
      @if (identity().contributionId; as contributionId) {
        <openg7-admin-sponsor-media-preference
          [contributionId]="contributionId"
          [disabled]="busy()"
          (busyChange)="preferenceBusy.set($event)"
          (changed)="moderationChanged.emit()"
        />
      }

      @if (identity().contributionId; as contributionId) {
        <div
          #gallery
          id="dossier-media-gallery"
          class="media-gallery admin-focus-target"
          data-og7="dossier-media-gallery"
          role="group"
          tabindex="-1"
          [attr.aria-label]="'admin.dossier.media.sectionTitle' | translate"
        >
          <openg7-media-review-workspace
            [contributionId]="contributionId"
            [headingLevel]="4"
            [disabled]="identity().mediaBusy || preferenceBusy()"
            (busyChange)="workspaceBusy.set($event)"
            (changed)="moderationChanged.emit()"
          />
        </div>
      }
    </section>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-detail-media.component.css'
  ]
})
export class AdminSponsorDetailMediaComponent {
  readonly moderationChanged = output<void>();
  readonly identity = input.required<AdminSponsorDetailIdentityView>();
  readonly preferenceBusy = signal(false);
  readonly workspaceBusy = signal(false);
  private readonly workspace = viewChild(MediaReviewWorkspaceComponent);
  private readonly gallery = viewChild<ElementRef<HTMLElement>>('gallery');
  readonly mediaCounts = computed(() => {
    const workspace = this.workspace();
    const contributionId = this.identity().contributionId;
    return workspace &&
      workspace.contributionId() === contributionId &&
      workspace.c.data()?.contributionId === contributionId &&
      !workspace.c.loading() &&
      !workspace.c.error()
      ? workspace.c.counts()
      : null;
  });
  readonly summaryLoading = computed(() => {
    const workspace = this.workspace();
    const contributionId = this.identity().contributionId;
    const data = workspace?.c.data();
    return (
      !workspace ||
      workspace.contributionId() !== contributionId ||
      workspace.c.loading() ||
      (!!data && data.contributionId !== contributionId)
    );
  });
  readonly summaryUnavailable = computed(() => {
    const workspace = this.workspace();
    return (
      !!workspace &&
      workspace.contributionId() === this.identity().contributionId &&
      !workspace.c.loading() &&
      !!workspace.c.error()
    );
  });
  readonly busy = computed(
    () =>
      this.identity().mediaBusy || this.workspaceBusy() || this.preferenceBusy()
  );

  focusGallery(): void {
    const gallery = this.gallery()?.nativeElement;
    gallery?.focus({ preventScroll: true });
    gallery?.scrollIntoView({ block: 'start' });
  }
}
