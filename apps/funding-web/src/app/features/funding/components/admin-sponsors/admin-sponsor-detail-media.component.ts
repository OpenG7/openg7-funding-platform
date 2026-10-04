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

import { AdminSponsorLogoPanelComponent } from './detail-media/admin-sponsor-logo-panel.component.js';
import { AdminSponsorMediaCardComponent } from './detail-media/admin-sponsor-media-card.component.js';

@Component({
  selector: 'openg7-admin-sponsor-detail-media',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    AdminSponsorLogoPanelComponent,
    AdminSponsorMediaCardComponent
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
        (uploadLogo)="uploadLogo.emit($event)"
        (deleteLogo)="deleteLogo.emit()"
      />

      <section class="media-review-panel" aria-labelledby="media-review-title">
        <header>
          <div>
            <span>{{
              'admin.legacy.medias_du_commanditaire' | translate
            }}</span>
            <h3 id="media-review-title">
              {{ 'admin.legacy.photos_en_revue' | translate }}
            </h3>
          </div>
          <div class="media-review-summary">
            <p>
              {{
                'admin.legacy.chaque_fichier_reste_prive_jusqu_a_son_approbation_le_texte_alter'
                  | translate
              }}
            </p>
            <button
              type="button"
              class="approve-all-action"
              [disabled]="
                identity().mediaBusy || identity().approvableMediaCount === 0
              "
              (click)="approveAllMedia.emit(pendingReviews())"
            >
              {{ 'admin.legacy.tout_approuver' | translate }}
            </button>
          </div>
        </header>

        <p class="muted-copy" *ngIf="identity().mediaAssets.length === 0">
          {{
            'admin.legacy.aucun_media_televerse_par_le_commanditaire'
              | translate
          }}
        </p>

        <div class="media-review-list">
          <openg7-admin-sponsor-media-card
            *ngFor="let asset of identity().mediaAssets; trackBy: trackAsset"
            [asset]="asset"
            [altText]="altTextFor(asset)"
            [mediaBusy]="identity().mediaBusy"
            (altTextChange)="setAltText(asset, $event)"
            (previewMedia)="previewMedia.emit($event)"
            (reviewMedia)="reviewMedia.emit($event)"
            (deleteMedia)="deleteMedia.emit($event)"
          />
        </div>

        <small class="inline-status" aria-live="polite">{{
          identity().mediaMessage
        }}</small>
      </section>
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

      button,
      input {
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
      }

      button:focus-visible,
      a:focus-visible,
      input:focus-visible {
        outline: 3px solid var(--admin-focus);
        outline-offset: 2px;
      }

      .detail-body {
        display: grid;
        gap: 0.9rem;
        overflow: auto;
        padding: 1rem;
      }

      .muted-copy {
        color: var(--admin-muted);
        margin: 0.35rem 0 0;
      }

      .media-review-panel {
        border-top: 1px solid var(--admin-border);
        display: grid;
        gap: 1rem;
        padding-top: 1rem;
      }

      .media-review-panel > header {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: minmax(0, 1fr) minmax(12rem, 0.8fr);
      }

      .media-review-panel header span {
        color: var(--admin-muted);
        font-size: 0.72rem;
        font-weight: var(--admin-label-weight);
        text-transform: uppercase;
      }

      .media-review-panel h3,
      .media-review-panel header p {
        margin: 0;
      }

      .media-review-panel h3 {
        margin-top: 0.2rem;
      }

      .media-review-panel header p {
        color: var(--admin-muted);
        font-size: 0.82rem;
      }

      .media-review-summary {
        display: grid;
        gap: 0.65rem;
        justify-items: start;
      }

      .approve-all-action {
        background: var(--og7-admin-success-bg, #193d32);
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        color: var(--admin-text);
        cursor: pointer;
        font-weight: var(--admin-control-weight);
        min-height: 2.5rem;
        padding: 0 0.85rem;
      }

      .approve-all-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .media-review-list {
        display: grid;
        gap: 1rem;
      }

      .inline-status {
        color: var(--admin-muted);
      }

      @media (max-width: 720px) {
        .media-review-panel > header {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class AdminSponsorDetailMediaComponent {
  readonly previewMedia = output<{ id: string; alt: string }>();
  readonly identity = input.required<AdminSponsorDetailIdentityView>();
  readonly uploadLogo = output<Event>();
  readonly deleteLogo = output<void>();
  readonly reviewMedia = output<AdminSponsorMediaReviewEvent>();
  readonly approveAllMedia = output<readonly AdminSponsorMediaReviewEvent[]>();
  readonly deleteMedia = output<AdminSponsorMediaDeleteEvent>();
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
          altText: this.altTextFor(asset)
        }))
  );

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
