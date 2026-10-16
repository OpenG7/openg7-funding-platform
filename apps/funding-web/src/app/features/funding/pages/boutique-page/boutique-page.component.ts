import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { BoutiqueProductCardComponent } from '../../components/boutique-product-card/boutique-product-card.component.js';
import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import {
  BOUTIQUE_FEATURED_PRODUCTS,
  BOUTIQUE_UNIVERSES
} from '../../config/boutique-products.config.js';
import type { BoutiqueUniverse } from '../../models/boutique-product.model.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

interface BoutiqueBenefit {
  readonly icon: string;
  readonly titleKey: string;
  readonly descriptionKey: string;
}

interface BoutiqueCollection {
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly tone: 'gold' | 'ember' | 'stone' | 'royal';
}

@Component({
  selector: 'openg7-boutique-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    FundingHeaderComponent,
    BoutiqueProductCardComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="boutique-page">
      <openg7-funding-header></openg7-funding-header>

      <section class="boutique-hero" aria-labelledby="boutique-title">
        <img
          class="boutique-background"
          src="assets/openg7-boutique-northdragon-background.png"
          [alt]="'funding.boutique.hero.backgroundAlt' | translate"
        />
        <div class="boutique-veil" aria-hidden="true"></div>

        <div class="boutique-hero-inner">
          <p class="eyebrow">
            {{ 'funding.boutique.hero.eyebrow' | translate }}
          </p>
          <h1 id="boutique-title">
            {{ 'funding.boutique.hero.title' | translate }}
          </h1>
          @if (selectionComingSoon) {
            <span class="coming-badge">
              <span aria-hidden="true">✦</span>
              {{ 'funding.boutique.hero.comingSoon' | translate }}
            </span>
          }
          <p class="hero-subtitle">
            {{ 'funding.boutique.hero.subtitle' | translate }}
          </p>
          <p class="hero-copy">
            {{ 'funding.boutique.hero.copy' | translate }}
          </p>
          <div class="hero-actions">
            <a
              class="primary-action"
              [href]="i18n.localizedPath('/boutique') + '#featured-products'"
              data-og7="boutique-discover-products"
            >
              {{ 'funding.boutique.links.discoverProducts' | translate }}
              <span aria-hidden="true">↓</span>
            </a>
            <a
              class="secondary-action"
              [href]="i18n.localizedPath('/boutique') + '#northdragon-universe'"
              >{{ 'funding.boutique.links.discoverUniverse' | translate }}</a
            >
          </div>
        </div>
      </section>

      <section
        id="featured-products"
        class="featured-section"
        aria-labelledby="featured-title"
        data-og7="boutique-featured"
        tabindex="-1"
      >
        <header class="section-heading">
          <p class="eyebrow">
            {{ 'funding.boutique.featured.eyebrow' | translate }}
          </p>
          <h2 id="featured-title">
            {{ 'funding.boutique.featured.title' | translate }}
          </h2>
          <p>{{ 'funding.boutique.featured.subtitle' | translate }}</p>
        </header>

        <div
          class="universe-filters"
          role="group"
          [attr.aria-label]="
            'funding.boutique.universes.filterLabel' | translate
          "
          data-og7="boutique-universes"
        >
          <button
            type="button"
            [attr.aria-pressed]="selectedUniverse() === 'all'"
            aria-controls="featured-grid"
            (click)="selectedUniverse.set('all')"
          >
            {{ 'funding.boutique.universes.all' | translate }}
          </button>
          @for (universe of universes; track universe) {
            <button
              type="button"
              [attr.aria-pressed]="selectedUniverse() === universe"
              aria-controls="featured-grid"
              (click)="selectedUniverse.set(universe)"
            >
              {{ 'funding.boutique.universes.' + universe | translate }}
            </button>
          }
        </div>
        <p
          class="selection-count"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {{
            'funding.boutique.universes.count'
              | translate: { count: visibleProducts().length }
          }}
        </p>
        <div id="featured-grid" class="featured-grid">
          @for (product of visibleProducts(); track product.id) {
            <openg7-boutique-product-card
              [product]="product"
              [locale]="i18n.currentLanguage()"
            />
          } @empty {
            <p class="selection-empty">
              {{ 'funding.boutique.featured.empty' | translate }}
            </p>
          }
        </div>
        <p class="featured-note">
          {{ 'funding.boutique.featured.purchaseNote' | translate }}
        </p>
      </section>

      <section
        class="benefits-band"
        [attr.aria-label]="'funding.boutique.benefits.ariaLabel' | translate"
      >
        <article *ngFor="let benefit of benefits">
          <span aria-hidden="true">{{ benefit.icon }}</span>
          <div>
            <h2>{{ benefit.titleKey | translate }}</h2>
            <p>{{ benefit.descriptionKey | translate }}</p>
          </div>
        </article>
      </section>

      <section class="collections-section" aria-labelledby="collections-title">
        <header class="section-heading">
          <p class="eyebrow">
            {{ 'funding.boutique.collections.eyebrow' | translate }}
          </p>
          <h2 id="collections-title">
            {{ 'funding.boutique.collections.title' | translate }}
          </h2>
          <p>{{ 'funding.boutique.collections.subtitle' | translate }}</p>
        </header>

        <div class="collection-grid">
          <article
            *ngFor="let collection of collections"
            [class]="collection.tone"
          >
            <span aria-hidden="true"></span>
            <h3>{{ collection.titleKey | translate }}</h3>
            <p>{{ collection.descriptionKey | translate }}</p>
            <a
              [href]="storeUrl"
              target="_blank"
              rel="noopener noreferrer"
              [attr.aria-label]="
                'funding.boutique.links.collectionAria'
                  | translate: { collection: collection.titleKey | translate }
              "
            >
              {{ 'funding.boutique.links.collection' | translate }}
              <span aria-hidden="true">↗</span>
            </a>
          </article>
        </div>
      </section>

      <section
        id="northdragon-universe"
        class="brand-story"
        aria-labelledby="brand-story-title"
      >
        <div>
          <p class="eyebrow">
            {{ 'funding.boutique.brand.eyebrow' | translate }}
          </p>
          <h2 id="brand-story-title">
            {{ 'funding.boutique.brand.title' | translate }}
          </h2>
          <p>{{ 'funding.boutique.brand.copy' | translate }}</p>
          <a
            [href]="storeUrl"
            target="_blank"
            rel="noopener noreferrer"
            [attr.aria-label]="'funding.boutique.links.visitAria' | translate"
          >
            {{ 'funding.boutique.links.visit' | translate }}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
        <blockquote>
          {{ 'funding.boutique.brand.quote' | translate }}
        </blockquote>
      </section>

      <section class="ecosystem-link" aria-labelledby="ecosystem-link-title">
        <p class="eyebrow">
          {{ 'funding.boutique.ecosystem.eyebrow' | translate }}
        </p>
        <h2 id="ecosystem-link-title">
          {{ 'funding.boutique.ecosystem.title' | translate }}
        </h2>
        <p>{{ 'funding.boutique.ecosystem.copy' | translate }}</p>
      </section>

      <section class="boutique-cta" aria-labelledby="boutique-cta-title">
        <h2 id="boutique-cta-title">
          {{ 'funding.boutique.cta.title' | translate }}
        </h2>
        <p>{{ 'funding.boutique.cta.copy' | translate }}</p>
        <div>
          <a
            class="primary-action"
            [href]="storeUrl"
            target="_blank"
            rel="noopener noreferrer"
            [attr.aria-label]="'funding.boutique.links.accessAria' | translate"
          >
            {{ 'funding.boutique.links.access' | translate }}
            <span aria-hidden="true">↗</span>
          </a>
          <a class="secondary-action" [routerLink]="i18n.localizedPath('/')">{{
            'funding.boutique.links.home' | translate
          }}</a>
        </div>
      </section>

      <footer class="boutique-footer">
        <span aria-hidden="true">◆</span>
        <p>
          <strong>{{ 'funding.boutique.footer.brand' | translate }}</strong>
          {{ 'funding.boutique.footer.copy' | translate }}
        </p>
      </footer>
    </main>
  `,
  styleUrl: './boutique-page.component.css'
})
export class BoutiquePageComponent {
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);
  readonly i18n = inject(FundingI18nService);

  readonly storeUrl = 'https://northdragon.org';
  readonly featuredProducts = BOUTIQUE_FEATURED_PRODUCTS;
  readonly universes = BOUTIQUE_UNIVERSES;
  readonly selectedUniverse = signal<BoutiqueUniverse | 'all'>('all');
  readonly visibleProducts = computed(() =>
    this.featuredProducts.filter(
      (product) =>
        this.selectedUniverse() === 'all' ||
        product.universe === this.selectedUniverse()
    )
  );
  readonly selectionComingSoon = this.featuredProducts.every(
    (product) => product.availability === 'coming-soon'
  );

  readonly benefits: readonly BoutiqueBenefit[] = [
    {
      icon: '✦',
      titleKey: 'funding.boutique.benefits.exclusive.title',
      descriptionKey: 'funding.boutique.benefits.exclusive.description'
    },
    {
      icon: '◈',
      titleKey: 'funding.boutique.benefits.onDemand.title',
      descriptionKey: 'funding.boutique.benefits.onDemand.description'
    },
    {
      icon: '◆',
      titleKey: 'funding.boutique.benefits.securePayment.title',
      descriptionKey: 'funding.boutique.benefits.securePayment.description'
    },
    {
      icon: '⌁',
      titleKey: 'funding.boutique.benefits.international.title',
      descriptionKey: 'funding.boutique.benefits.international.description'
    },
    {
      icon: '◎',
      titleKey: 'funding.boutique.benefits.support.title',
      descriptionKey: 'funding.boutique.benefits.support.description'
    }
  ];

  readonly collections: readonly BoutiqueCollection[] = [
    {
      titleKey: 'funding.boutique.collections.items.clothing.title',
      descriptionKey: 'funding.boutique.collections.items.clothing.description',
      tone: 'gold'
    },
    {
      titleKey: 'funding.boutique.collections.items.accessories.title',
      descriptionKey:
        'funding.boutique.collections.items.accessories.description',
      tone: 'ember'
    },
    {
      titleKey: 'funding.boutique.collections.items.home.title',
      descriptionKey: 'funding.boutique.collections.items.home.description',
      tone: 'stone'
    },
    {
      titleKey: 'funding.boutique.collections.items.special.title',
      descriptionKey: 'funding.boutique.collections.items.special.description',
      tone: 'royal'
    }
  ];

  constructor() {
    this.seo.bind(
      {
        titleKey: 'funding.boutique.seo.title',
        descriptionKey: 'funding.boutique.seo.description',
        path: '/boutique',
        imagePath: '/assets/openg7-boutique-northdragon-background.png'
      },
      this.injector
    );
  }
}
