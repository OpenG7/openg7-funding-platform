import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal
} from '@angular/core';

import type {
  AdminSponsorDetailIdentityView,
  AdminSponsorMediaAssetView,
  AdminSponsorMediaDeleteEvent,
  AdminSponsorMediaReviewEvent
} from '../../models/admin-sponsors-ui.models.js';
import { AdminSponsorMediaPreferenceComponent } from '../sponsor-media-usage/admin-sponsor-media-preference.component.js';

import { AdminSponsorLogoPanelComponent } from './detail-media/admin-sponsor-logo-panel.component.js';
import { AdminSponsorMediaCardComponent } from './detail-media/admin-sponsor-media-card.component.js';

@Component({
  selector: 'openg7-admin-sponsor-detail-media',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    AdminSponsorLogoPanelComponent,
    AdminSponsorMediaCardComponent,
    AdminSponsorMediaPreferenceComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="detail-body admin-focus-target"
      id="dossier-media"
      tabindex="-1"
      [attr.aria-label]="'admin.legacy.medias_du_commanditaire' | translate"
    >
      <openg7-admin-sponsor-logo-panel
        [identity]="identity()"
        [disabled]="busy()"
        (uploadLogo)="uploadLogo.emit($event)"
        (deleteLogo)="deleteLogo.emit()"
      />
      @if (identity().contributionId; as contributionId) {
        <openg7-admin-sponsor-media-preference
          [contributionId]="contributionId"
          [disabled]="busy()"
          (busyChange)="preferenceBusy.set($event)"
          (changed)="moderationChanged.emit()"
        />
      }

      <section
        class="media-review-panel"
        data-og7="media-review-panel"
        aria-labelledby="media-review-title"
      >
        <header>
          <div>
            <h3 id="media-review-title">
              {{ 'admin.legacy.photos_en_revue' | translate }}
            </h3>
            <p class="muted-copy">
              {{
                'admin.legacy.chaque_fichier_reste_prive_jusqu_a_son_approbation_le_texte_alter'
                  | translate
              }}
            </p>
          </div>
          @if (identity().mediaAssets.length > 0) {
            <button
              type="button"
              class="admin-button approve-all-action"
              data-og7="admin-media-approve-all"
              [disabled]="
                busy() ||
                identity().approvableMediaCount === 0 ||
                !allUsageReady()
              "
              (click)="approveAll()"
            >
              {{ 'admin.legacy.tout_approuver' | translate }}
            </button>
          }
        </header>

        @if (identity().mediaAssets.length === 0) {
          <div class="empty-state" data-og7="admin-sponsor-photos-empty">
            <p>
              {{
                'admin.legacy.aucun_media_televerse_par_le_commanditaire'
                  | translate
              }}
            </p>
            <p class="muted-copy">
              {{ 'admin.dossier.media.photosEmptyHelp' | translate }}
            </p>
          </div>
        } @else {
          <div class="media-review-list">
            <openg7-admin-sponsor-media-card
              *ngFor="let asset of identity().mediaAssets; trackBy: trackAsset"
              [asset]="asset"
              [altText]="altTextFor(asset)"
              [mediaBusy]="busy()"
              (busyChange)="setUsageBusy(asset, $event)"
              (restrictionsChange)="setRestrictions(asset, $event)"
              (altTextChange)="setAltText(asset, $event)"
              (previewMedia)="previewMedia.emit($event)"
              (reviewMedia)="reviewMedia.emit($event)"
              (deleteMedia)="deleteMedia.emit($event)"
              (moderationChanged)="moderationChanged.emit()"
            />
          </div>
        }

        @if (identity().mediaMessage) {
          <p class="inline-status" role="status">
            {{ identity().mediaMessage }}
          </p>
        }
      </section>
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
  readonly previewMedia = output<{ id: string; alt: string }>();
  readonly identity = input.required<AdminSponsorDetailIdentityView>();
  readonly uploadLogo = output<Event>();
  readonly deleteLogo = output<void>();
  readonly reviewMedia = output<AdminSponsorMediaReviewEvent>();
  readonly approveAllMedia = output<readonly AdminSponsorMediaReviewEvent[]>();
  readonly deleteMedia = output<AdminSponsorMediaDeleteEvent>();
  private readonly usageBusy = signal<Record<string, boolean>>({});
  readonly preferenceBusy = signal(false);
  private readonly restrictions = signal<Record<string, string>>({});
  readonly busy = computed(
    () =>
      this.identity().mediaBusy ||
      this.preferenceBusy() ||
      this.identity().mediaAssets.some((asset) => this.usageBusy()[asset.id])
  );
  readonly allUsageReady = computed(() =>
    this.identity()
      .mediaAssets.filter((asset) => asset.reviewStatus !== 'approved')
      .every(
        (asset) =>
          asset.usage?.state === 'confirmed' &&
          (!asset.usage.restrictions ||
            asset.usageRestrictionsReviewed ||
            this.restrictions()[asset.id] === asset.version)
      )
  );
  private readonly altDrafts = signal<
    Record<string, { version: string; text: string }>
  >({});
  readonly pendingReviews = computed<readonly AdminSponsorMediaReviewEvent[]>(
    () =>
      this.identity()
        .mediaAssets.filter((asset) => asset.reviewStatus !== 'approved')
        .map((asset) => ({
          assetId: asset.id,
          expectedVersion: asset.version,
          reviewStatus: 'approved',
          altText: this.altTextFor(asset),
          ...(this.restrictions()[asset.id] === asset.version
            ? { usageRestrictionsConfirmed: true as const }
            : {})
        }))
  );
  setUsageBusy(asset: AdminSponsorMediaAssetView, value: boolean): void {
    this.usageBusy.update((state) => ({ ...state, [asset.id]: value }));
  }
  approveAll(): void {
    if (
      !this.busy() &&
      this.identity().approvableMediaCount > 0 &&
      this.allUsageReady()
    ) {
      this.approveAllMedia.emit(this.pendingReviews());
    }
  }
  setRestrictions(asset: AdminSponsorMediaAssetView, value: boolean): void {
    this.restrictions.update((state) => ({
      ...state,
      [asset.id]: value ? asset.version : ''
    }));
  }

  altTextFor(asset: AdminSponsorMediaAssetView): string {
    const draft = this.altDrafts()[asset.id];
    return draft?.version === asset.version ? draft.text : asset.altText;
  }

  trackAsset(_index: number, asset: AdminSponsorMediaAssetView): string {
    return asset.id;
  }

  setAltText(asset: AdminSponsorMediaAssetView, text: string): void {
    this.altDrafts.update((drafts) => ({
      ...drafts,
      [asset.id]: { version: asset.version, text }
    }));
  }
}
