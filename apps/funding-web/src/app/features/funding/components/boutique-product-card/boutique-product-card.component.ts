import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { BoutiqueProduct } from '../../models/boutique-product.model.js';

/** Presentation molecule, local to the public boutique. */
@Component({
  selector: 'openg7-boutique-product-card',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      data-og7="boutique-product"
      [attr.data-og7-id]="product().id"
      [attr.data-universe]="product().universe"
    >
      @if (
        product().availability === 'available' && product().productUrl;
        as url
      ) {
        <a
          [href]="url"
          target="_blank"
          rel="noopener noreferrer"
          [attr.aria-label]="
            'funding.boutique.product.viewAria'
              | translate: { product: product().titleKey | translate }
          "
        >
          <ng-container *ngTemplateOutlet="content"></ng-container>
        </a>
      } @else {
        <div class="card-content">
          <ng-container *ngTemplateOutlet="content"></ng-container>
        </div>
      }
    </article>

    <ng-template #content>
      <div class="product-visual">
        @if (visibleImage(); as image) {
          <img
            [src]="image.src"
            [alt]="image.altKey | translate"
            [style.object-fit]="image.fit ?? 'contain'"
            width="960"
            height="1200"
            loading="lazy"
            decoding="async"
            (error)="failedImageSrc.set(image.src)"
          />
        } @else {
          <div class="image-placeholder" data-og7="boutique-image-placeholder">
            <span class="placeholder-mark" aria-hidden="true">N</span>
            <span>
              {{
                (product().image
                  ? 'funding.boutique.product.imageUnavailable'
                  : 'funding.boutique.product.imageComingSoon'
                ) | translate
              }}
            </span>
          </div>
        }
      </div>
      <div class="product-details">
        <span class="product-universe">{{
          'funding.boutique.universes.' + product().universe | translate
        }}</span>
        <span class="product-status">
          {{
            'funding.boutique.product.status.' + product().availability
              | translate
          }}
        </span>
        <h3>{{ product().titleKey | translate }}</h3>
        <p>{{ product().descriptionKey | translate }}</p>
        @if (formattedPrice(); as price) {
          <strong class="product-price" data-og7="boutique-product-price">{{
            price
          }}</strong>
        }
        @if (product().availability === 'available' && product().productUrl) {
          <span class="product-action">
            {{ 'funding.boutique.product.view' | translate }}
            <span aria-hidden="true">↗</span>
          </span>
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      article {
        --universe-accent: var(--color-gold);
        --universe-glow: rgb(184 142 63 / 16%);
        background: var(--surface-panel);
        border: 1px solid var(--border-color);
        border-radius: 0.75rem;
        height: 100%;
        overflow: hidden;
      }

      article[data-universe='princesses'] {
        --universe-accent: #844478;
        --universe-glow: rgb(177 106 189 / 20%);
      }

      article[data-universe='unicorns'] {
        --universe-accent: #286b67;
        --universe-glow: rgb(91 170 176 / 20%);
      }

      a,
      .card-content {
        color: inherit;
        display: flex;
        flex-direction: column;
        height: 100%;
        text-decoration: none;
      }

      a:focus-visible {
        outline: 3px solid var(--color-primary);
        outline-offset: -3px;
      }

      a:hover .product-action {
        background: var(--color-primary);
        color: var(--on-primary);
      }

      .product-visual {
        aspect-ratio: 4 / 5;
        background: var(--surface-page);
        overflow: hidden;
      }

      img {
        display: block;
        height: 100%;
        width: 100%;
      }

      .image-placeholder {
        align-items: center;
        background:
          radial-gradient(
            ellipse at 50% 35%,
            var(--universe-glow),
            transparent 70%
          ),
          var(--surface-raised);
        color: var(--text-soft);
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        height: 100%;
        justify-content: center;
        padding: 1rem;
        text-align: center;
      }

      .placeholder-mark {
        border: 1px solid var(--border-color);
        color: var(--universe-accent);
        font-family: Georgia, serif;
        font-size: 3rem;
        line-height: 1;
        padding: 1rem 1.35rem;
      }

      .product-details {
        align-items: flex-start;
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1.5rem;
      }

      .product-status {
        color: var(--text-soft);
        font-size: 0.875rem;
        font-weight: 700;
      }

      .product-universe {
        color: var(--universe-accent);
        font-size: 0.875rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      h3 {
        color: var(--text-main);
        font-family: Georgia, serif;
        font-size: 1.2rem;
        line-height: 1.25;
        margin: 0;
        overflow-wrap: anywhere;
      }

      p,
      .image-placeholder,
      .product-universe,
      .product-status,
      .product-price,
      .product-action {
        font-family: inherit;
      }

      p {
        color: var(--text-soft);
        font-size: 1rem;
        line-height: 1.5;
        margin: 0;
      }

      .product-price {
        color: var(--text-main);
        font-size: 1.1rem;
      }

      .product-action {
        align-items: center;
        border: 1px solid var(--color-primary);
        border-radius: 0.4rem;
        color: var(--color-primary);
        display: flex;
        font-size: 0.875rem;
        gap: 0.5rem;
        justify-content: space-between;
        margin-top: auto;
        min-height: 2.75rem;
        padding: 0.5rem 0.75rem;
        width: 100%;
      }

      @media (max-width: 560px) {
        .product-details {
          padding: 1rem;
        }
      }
    `
  ]
})
export class BoutiqueProductCardComponent {
  readonly product = input.required<BoutiqueProduct>();
  readonly locale = input.required<'fr-CA' | 'en'>();
  readonly failedImageSrc = signal<string | null>(null);
  readonly visibleImage = computed(() => {
    const image = this.product().image;
    return image?.src && image.src !== this.failedImageSrc() ? image : null;
  });
  readonly formattedPrice = computed(() => {
    const price = this.product().price;
    if (
      !price ||
      !Number.isSafeInteger(price.amountMinor) ||
      price.amountMinor < 0
    ) {
      return null;
    }
    return new Intl.NumberFormat(this.locale(), {
      style: 'currency',
      currency: price.currency,
      currencyDisplay: 'code'
    }).format(price.amountMinor / 100);
  });
}
