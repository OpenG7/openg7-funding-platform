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
  styleUrl: './boutique-product-card.component.css'
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
