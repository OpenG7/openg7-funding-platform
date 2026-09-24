import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type {
  AdminSponsorDetailIdentityView,
  AdminSponsorMediaDeleteEvent,
  AdminSponsorMediaReviewEvent
} from '../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsor-detail-media',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="detail-body"
      [attr.aria-label]="'admin.legacy.medias_du_commanditaire' | translate"
    >
      <article class="detail-card">
        <h3>{{ 'admin.legacy.logo_actuel' | translate }}</h3>
        <figure
          class="logo-preview large-preview"
          *ngIf="identity().logoPreviewSource; else noLogoPreview"
        >
          <img
            [src]="identity().logoPreviewSource"
            [alt]="'Logo ' + (identity().companyName || 'commanditaire')"
          />
        </figure>
        <ng-template #noLogoPreview
          ><p class="muted-copy">
            {{ 'admin.legacy.aucun_logo_disponible' | translate }}
          </p></ng-template
        >
        <dl class="compact-definition-list">
          <div>
            <dt>{{ 'admin.legacy.url_du_logo' | translate }}</dt>
            <dd>
              <a
                *ngIf="identity().logoUrl; else emptyLogoUrl"
                [href]="identity().logoUrl"
                target="_blank"
                rel="noreferrer"
                >{{ identity().logoUrl }}</a
              ><ng-template #emptyLogoUrl>{{
                'admin.legacy.non_fourni' | translate
              }}</ng-template>
            </dd>
          </div>
          <div>
            <dt>{{ 'admin.legacy.nom_public' | translate }}</dt>
            <dd>{{ identity().publicNameLabel }}</dd>
          </div>
          <div>
            <dt>{{ 'admin.legacy.site_web_public' | translate }}</dt>
            <dd>
              {{
                identity().websiteUrl || ('admin.legacy.non_fourni' | translate)
              }}
            </dd>
          </div>
        </dl>
        <div class="logo-actions">
          <label class="logo-upload-control"
            >{{ identity().logoActionLabel
            }}<input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              [disabled]="identity().uploadDisabled"
              (change)="uploadLogo.emit($event)" /></label
          ><button
            type="button"
            class="secondary-danger-action"
            [disabled]="identity().deleteDisabled"
            (click)="deleteLogo.emit()"
          >
            {{ 'admin.legacy.supprimer_le_logo' | translate }}
          </button>
        </div>
        <small class="inline-status" aria-live="polite">{{
          identity().statusMessage
        }}</small>
      </article>

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
              (click)="approveAllMedia.emit()"
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
          <div
            class="media-review-item"
            *ngFor="let asset of identity().mediaAssets"
            data-og7="admin-sponsor-media"
            [attr.data-og7-id]="asset.id"
          >
            <div class="media-preview">
              <img
                *ngIf="asset.previewSource"
                [src]="asset.previewSource"
                [alt]="asset.altText || asset.kindLabel"
              />
            </div>

            <div class="media-review-copy">
              <div class="media-review-heading">
                <strong>{{ asset.kindLabel }}</strong>
                <span [class]="'media-status ' + asset.reviewStatus">
                  {{ asset.reviewStatusLabel }}
                </span>
              </div>
              <small>{{ asset.dimensionsLabel }} · {{ asset.sizeLabel }}</small>
              <label>
                {{ 'admin.legacy.texte_alternatif' | translate
                }}<span>{{ 'admin.legacy.optionnel' | translate }}</span>
                <input
                  #altTextInput
                  type="text"
                  maxlength="300"
                  [attr.placeholder]="
                    'admin.legacy.description_publique_automatique_si_vide'
                      | translate
                  "
                  [value]="asset.altText"
                  [disabled]="identity().mediaBusy"
                />
              </label>
              <div class="media-review-actions">
                <button
                  type="button"
                  (click)="
                    previewMedia.emit({
                      id: asset.id,
                      alt: asset.altText || asset.kindLabel
                    })
                  "
                >
                  {{ 'admin.inspector.preview' | translate }}
                </button>
                <button
                  type="button"
                  class="approve-action"
                  [disabled]="
                    identity().mediaBusy || asset.reviewStatus === 'approved'
                  "
                  (click)="
                    reviewMedia.emit({
                      assetId: asset.id,
                      expectedVersion: asset.version,
                      reviewStatus: 'approved',
                      altText: altTextInput.value
                    })
                  "
                >
                  {{ 'admin.legacy.approuver_le_media' | translate }}
                </button>
                <button
                  type="button"
                  class="reject-action"
                  [disabled]="identity().mediaBusy"
                  (click)="
                    reviewMedia.emit({
                      assetId: asset.id,
                      expectedVersion: asset.version,
                      reviewStatus: 'rejected',
                      altText: altTextInput.value
                    })
                  "
                >
                  {{ 'admin.legacy.refuser' | translate }}
                </button>
                <button
                  type="button"
                  class="secondary-danger-action"
                  [disabled]="identity().mediaBusy"
                  (click)="
                    deleteMedia.emit({
                      assetId: asset.id,
                      expectedVersion: asset.version
                    })
                  "
                >
                  {{ 'admin.legacy.supprimer' | translate }}
                </button>
              </div>
            </div>
          </div>
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
        font: inherit;
      }

      button:focus-visible,
      a:focus-visible,
      input:focus-visible {
        outline: 3px solid rgba(37, 99, 235, 0.28);
        outline-offset: 2px;
      }

      .secondary-danger-action {
        align-items: center;
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        color: var(--admin-danger);
        cursor: pointer;
        display: inline-flex;
        font-weight: 900;
        justify-content: center;
        min-height: 2.5rem;
        padding: 0 0.85rem;
        text-decoration: none;
      }

      .secondary-danger-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
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

      .muted-copy {
        color: var(--admin-muted);
        line-height: 1.55;
        margin: 0.35rem 0 0;
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

      .compact-definition-list {
        display: grid;
        gap: 0.75rem;
        margin: 0;
      }

      .logo-preview {
        align-items: center;
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.35rem;
        display: flex;
        height: 4.5rem;
        justify-content: center;
        overflow: hidden;
        width: 8rem;
      }

      .large-preview {
        height: 8rem;
        width: 12rem;
      }

      .logo-preview img {
        max-height: 100%;
        max-width: 100%;
        object-fit: contain;
      }

      .logo-actions {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .logo-upload-control {
        display: grid;
        font-size: 0.84rem;
        font-weight: 800;
        gap: 0.35rem;
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
        font-weight: 900;
        text-transform: uppercase;
      }

      .media-review-panel h3,
      .media-review-panel header p {
        margin: 0;
      }

      .media-review-panel h3 {
        font-size: 1rem;
        margin-top: 0.2rem;
      }

      .media-review-panel header p {
        color: var(--admin-muted);
        font-size: 0.82rem;
        line-height: 1.5;
      }

      .media-review-summary {
        display: grid;
        gap: 0.65rem;
        justify-items: start;
      }

      .approve-all-action {
        background: #193d32;
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        color: var(--admin-text);
        cursor: pointer;
        font-weight: 900;
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

      .media-review-item {
        align-items: start;
        display: grid;
        gap: 1rem;
        grid-template-columns: 11rem minmax(0, 1fr);
      }

      .media-preview {
        align-items: center;
        aspect-ratio: 4 / 3;
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        display: flex;
        justify-content: center;
        overflow: hidden;
      }

      .media-preview img {
        height: 100%;
        object-fit: contain;
        width: 100%;
      }

      .media-review-copy {
        display: grid;
        gap: 0.65rem;
        min-width: 0;
      }

      .media-review-heading {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        justify-content: space-between;
      }

      .media-review-copy small {
        color: var(--admin-muted);
      }

      .media-review-copy label {
        display: grid;
        font-size: 0.78rem;
        font-weight: 800;
        gap: 0.35rem;
      }

      .media-review-copy label span {
        color: var(--admin-muted);
        font-weight: 700;
      }

      .media-review-copy input {
        border: 1px solid var(--admin-border);
        border-radius: 0.35rem;
        min-height: 2.5rem;
        padding: 0.55rem 0.65rem;
        width: 100%;
      }

      .media-status {
        font-size: 0.72rem;
        font-weight: 900;
      }

      .media-status.approved {
        color: var(--admin-success);
      }

      .media-status.pending_review {
        color: var(--admin-warning);
      }

      .media-status.rejected {
        color: var(--admin-danger);
      }

      .media-review-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
      }

      .approve-action,
      .reject-action {
        border-radius: 0.4rem;
        cursor: pointer;
        font-weight: 900;
        min-height: 2.5rem;
        padding: 0 0.85rem;
      }

      .approve-action {
        background: #193d32;
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
      }

      .reject-action {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        color: var(--admin-danger);
      }

      .approve-action:disabled,
      .reject-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .inline-status {
        color: var(--admin-muted);
      }

      @media (max-width: 720px) {
        .media-review-panel > header,
        .media-review-item {
          grid-template-columns: 1fr;
        }

        .media-preview {
          max-width: 16rem;
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
  readonly approveAllMedia = output<void>();
  readonly deleteMedia = output<AdminSponsorMediaDeleteEvent>();
}
