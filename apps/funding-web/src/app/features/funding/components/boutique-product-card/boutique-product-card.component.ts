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
        --universe-accent: #e4bf6b;
        --universe-glow: rgb(184 142 63 / 16%);
        background: #111214;
        border: 1px solid rgb(201 154 61 / 34%);
        border-radius: 0.75rem;
        height: 100%;
        overflow: hidden;
      }

      article[data-universe='princesses'] {
        --universe-accent: #edc7ed;
        --universe-glow: rgb(177 106 189 / 20%);
      }

      article[data-universe='unicorns'] {
        --universe-accent: #bde5e2;
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
        outline: 3px solid #ffe08a;
        outline-offset: -3px;
      }

      a:hover .product-action {
        background: #ffe08a;
        color: #101114;
      }

      .product-visual {
        aspect-ratio: 4 / 5;
        background: #eeebe5;
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
          #18191c;
        color: #d8cfbe;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        height: 100%;
        justify-content: center;
        padding: 1rem;
        text-align: center;
      }

      .placeholder-mark {
        border: 1px solid rgb(201 154 61 / 45%);
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
        padding: 1rem;
      }

      .product-status {
        color: #d8cfbe;
        font-size: 0.75rem;
        font-weight: 700;
      }

      .product-universe {
        color: var(--universe-accent);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      h3 {
        color: #fff2d2;
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
        font-family: 'Trebuchet MS', sans-serif;
      }

      p {
        color: #d8cfbe;
        font-size: 0.9rem;
        line-height: 1.5;
        margin: 0;
      }

      .product-price {
        color: #fff2d2;
        font-size: 1.1rem;
      }

      .product-action {
        align-items: center;
        border: 1px solid rgb(244 201 87 / 42%);
        border-radius: 0.4rem;
        color: #fff1c8;
        display: flex;
        font-size: 0.85rem;
        gap: 0.5rem;
        justify-content: space-between;
        margin-top: auto;
        min-height: 2.75rem;
        padding: 0.5rem 0.75rem;
        width: 100%;
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
