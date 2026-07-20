import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { AdminSponsorDetailIdentityView } from '../../models/admin-sponsors-ui.models.js';

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

      .inline-status {
        color: #667085;
      }
    `
  ]
})
export class AdminSponsorDetailIdentityComponent {
  readonly identity = input.required<AdminSponsorDetailIdentityView>();
  readonly uploadLogo = output<Event>();
  readonly deleteLogo = output<void>();
}
