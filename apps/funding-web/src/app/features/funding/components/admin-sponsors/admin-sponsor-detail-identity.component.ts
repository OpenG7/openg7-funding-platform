import { CommonModule } from '@angular/common';
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
  selector: 'openg7-admin-sponsor-detail-identity',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="detail-body" aria-label="Identite et logo">
      <article class="detail-card">
        <h3>Logo actuel</h3>
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
          ><p class="muted-copy">Aucun logo disponible.</p></ng-template
        >
        <dl class="compact-definition-list">
          <div>
            <dt>URL du logo</dt>
            <dd>
              <a
                *ngIf="identity().logoUrl; else emptyLogoUrl"
                [href]="identity().logoUrl"
                target="_blank"
                rel="noreferrer"
                >{{ identity().logoUrl }}</a
              ><ng-template #emptyLogoUrl>Non fourni</ng-template>
            </dd>
          </div>
          <div>
            <dt>Nom public</dt>
            <dd>{{ identity().publicNameLabel }}</dd>
          </div>
          <div>
            <dt>Site web public</dt>
            <dd>{{ identity().websiteUrl || 'Non fourni' }}</dd>
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
            Supprimer le logo
          </button>
        </div>
        <small class="inline-status" aria-live="polite">{{
          identity().statusMessage
        }}</small>
      </article>

      <section class="media-review-panel" aria-labelledby="media-review-title">
        <header>
          <div>
            <span>Medias du commanditaire</span>
            <h3 id="media-review-title">Photos en revue</h3>
          </div>
          <p>
            Chaque fichier reste prive jusqu'a son approbation. Le texte
            alternatif est requis avant publication.
          </p>
        </header>

        <p class="muted-copy" *ngIf="identity().mediaAssets.length === 0">
          Aucun media televerse par le commanditaire.
        </p>

        <div class="media-review-list">
          <div
            class="media-review-item"
            *ngFor="let asset of identity().mediaAssets"
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
                Texte alternatif
                <input
                  #altTextInput
                  type="text"
                  maxlength="300"
                  [value]="asset.altText"
                  [disabled]="identity().mediaBusy"
                />
              </label>
              <div class="media-review-actions">
                <button
                  type="button"
                  class="approve-action"
                  [disabled]="identity().mediaBusy"
                  (click)="
                    reviewMedia.emit({
                      assetId: asset.id,
                      expectedVersion: asset.version,
                      reviewStatus: 'approved',
                      altText: altTextInput.value
                    })
                  "
                >
                  Approuver
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
                  Refuser
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
                  Supprimer
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
        background: #fff8f8;
        border: 1px solid #f1a8b4;
        border-radius: 0.4rem;
        color: #9f1d2f;
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

      .muted-copy {
        color: #566274;
        line-height: 1.55;
        margin: 0.35rem 0 0;
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

      .compact-definition-list {
        display: grid;
        gap: 0.75rem;
        margin: 0;
      }

      .logo-preview {
        align-items: center;
        background: #f4f7fb;
        border: 1px solid #d9e0ea;
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
        border-top: 1px solid #d9e0ea;
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
        color: #667085;
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
        color: #566274;
        font-size: 0.82rem;
        line-height: 1.5;
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
        background: #edf1f6;
        border: 1px solid #d9e0ea;
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
        color: #667085;
      }

      .media-review-copy label {
        display: grid;
        font-size: 0.78rem;
        font-weight: 800;
        gap: 0.35rem;
      }

      .media-review-copy input {
        border: 1px solid #b8c3d1;
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
        color: #137047;
      }

      .media-status.pending_review {
        color: #8a5a00;
      }

      .media-status.rejected {
        color: #9f1d2f;
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
        background: #176b43;
        border: 1px solid #176b43;
        color: #ffffff;
      }

      .reject-action {
        background: #fff8f8;
        border: 1px solid #d97888;
        color: #8b2032;
      }

      .approve-action:disabled,
      .reject-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .inline-status {
        color: #667085;
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
export class AdminSponsorDetailIdentityComponent {
  readonly identity = input.required<AdminSponsorDetailIdentityView>();
  readonly uploadLogo = output<Event>();
  readonly deleteLogo = output<void>();
  readonly reviewMedia = output<AdminSponsorMediaReviewEvent>();
  readonly deleteMedia = output<AdminSponsorMediaDeleteEvent>();
}
