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
  styles: [
    `
      :host {
        display: block;
      }

      .boutique-page {
        background:
          radial-gradient(
            circle at 12% 8%,
            rgb(244 201 87 / 12%),
            transparent 22rem
          ),
          linear-gradient(180deg, #070809 0%, #101114 42%, #050506 100%);
        color: var(--text-main);
        font-family: Georgia, 'Times New Roman', serif;
        min-height: 100dvh;
        overflow: hidden;
      }

      .boutique-hero {
        align-items: center;
        display: grid;
        min-height: 32rem;
        overflow: hidden;
        padding: clamp(2rem, 4vw, 3.5rem) clamp(1rem, 7vw, 7rem);
        position: relative;
      }

      .boutique-background,
      .boutique-veil {
        inset: 0;
        position: absolute;
      }

      .boutique-background {
        height: 100%;
        object-fit: cover;
        object-position: center center;
        transform: scaleX(-1);
        width: 100%;
      }

      .boutique-veil {
        background:
          radial-gradient(
            circle at 50% 40%,
            rgb(0 0 0 / 88%) 0 19rem,
            rgb(0 0 0 / 62%) 34rem,
            transparent 62rem
          ),
          linear-gradient(
            90deg,
            rgb(0 0 0 / 18%) 0%,
            rgb(0 0 0 / 72%) 28%,
            rgb(0 0 0 / 84%) 53%,
            rgb(0 0 0 / 22%) 100%
          ),
          linear-gradient(
            180deg,
            rgb(0 0 0 / 34%) 0%,
            rgb(0 0 0 / 10%) 48%,
            #070809 100%
          );
      }

      .boutique-hero::after {
        border: 1px solid rgb(244 201 87 / 24%);
        content: '';
        inset: clamp(0.75rem, 2vw, 1.5rem);
        pointer-events: none;
        position: absolute;
      }

      .boutique-hero-inner {
        background:
          linear-gradient(180deg, rgb(12 13 15 / 74%), rgb(5 5 6 / 66%)),
          rgb(13 15 18 / 76%);
        border: 1px solid rgb(244 201 87 / 38%);
        box-shadow:
          inset 0 1px 0 rgb(255 235 168 / 11%),
          0 28px 80px rgb(0 0 0 / 42%);
        max-width: 48rem;
        padding: clamp(1.35rem, 4vw, 3rem);
        position: relative;
        z-index: 1;
      }

      .eyebrow {
        color: #e4bf6b;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0;
        margin: 0;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3,
      p,
      blockquote {
        margin: 0;
      }

      h1 {
        color: #fff4d4;
        font-size: clamp(2.8rem, 6vw, 5rem);
        line-height: 0.9;
        margin-top: 0.6rem;
        text-shadow:
          0 0 34px rgb(244 201 87 / 18%),
          0 10px 36px rgb(0 0 0 / 74%);
      }

      .coming-badge {
        align-items: center;
        background: rgb(91 63 15 / 34%);
        border: 1px solid rgb(244 201 87 / 68%);
        border-radius: 999px;
        box-shadow: 0 0 24px rgb(244 201 87 / 14%);
        color: #ffe8a6;
        display: inline-flex;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.86rem;
        font-weight: 900;
        gap: 0.4rem;
        margin-top: 0.9rem;
        padding: 0.46rem 0.85rem;
        text-transform: uppercase;
      }

      .hero-subtitle {
        color: #f7f2e8;
        font-size: clamp(1.12rem, 2.2vw, 1.55rem);
        line-height: 1.35;
        margin-top: 1rem;
      }

      .hero-copy,
      .section-heading p,
      .brand-story p,
      .ecosystem-link p,
      .boutique-cta p,
      .boutique-footer p {
        color: #d8cfbe;
        font-family: 'Trebuchet MS', sans-serif;
        line-height: 1.55;
      }

      .hero-copy {
        font-size: 1.02rem;
        margin-top: 0.85rem;
        max-width: 39rem;
      }

      .hero-actions,
      .boutique-cta div {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1.45rem;
      }

      .primary-action,
      .secondary-action,
      .collection-grid a,
      .brand-story a {
        align-items: center;
        border-radius: 0.5rem;
        display: inline-flex;
        font-family: 'Trebuchet MS', sans-serif;
        font-weight: 900;
        gap: 0.35rem;
        justify-content: center;
        min-height: 2.8rem;
        padding: 0 1.15rem;
        text-decoration: none;
      }

      .primary-action {
        background: linear-gradient(180deg, #ffe08a 0%, #d99b2e 100%);
        border: 1px solid #ffe69a;
        color: #09111c;
      }

      .secondary-action,
      .collection-grid a,
      .brand-story a {
        background: rgb(10 11 13 / 62%);
        border: 1px solid rgb(244 201 87 / 42%);
        color: #fff1c8;
      }

      .benefits-band,
      .collections-section,
      .featured-section,
      .brand-story,
      .ecosystem-link,
      .boutique-cta,
      .boutique-footer {
        margin-left: clamp(1rem, 6vw, 6rem);
        margin-right: clamp(1rem, 6vw, 6rem);
      }

      .benefits-band {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        margin-top: clamp(1rem, 3vw, 1.6rem);
      }

      .benefits-band article,
      .collection-grid article,
      .brand-story,
      .ecosystem-link,
      .boutique-cta,
      .boutique-footer {
        background:
          linear-gradient(180deg, rgb(18 20 24 / 82%), rgb(7 8 9 / 74%)),
          rgb(13 15 18 / 82%);
        border: 1px solid rgb(201 154 61 / 34%);
        box-shadow:
          inset 0 1px 0 rgb(255 235 168 / 10%),
          0 18px 48px rgb(0 0 0 / 26%);
      }

      .benefits-band article {
        display: grid;
        gap: 0.7rem;
        grid-template-columns: auto 1fr;
        min-height: 9.4rem;
        padding: 1rem;
      }

      .benefits-band article > span {
        align-items: center;
        background: radial-gradient(
          circle,
          rgb(244 201 87 / 20%),
          rgb(8 8 8 / 72%)
        );
        border: 1px solid rgb(244 201 87 / 38%);
        border-radius: 0.55rem;
        color: #ffe3a0;
        display: inline-flex;
        font-size: 1.2rem;
        height: 2.8rem;
        justify-content: center;
        width: 2.8rem;
      }

      .benefits-band h2,
      .collection-grid h3 {
        color: #fff2d2;
        font-size: 1.02rem;
        line-height: 1.1;
      }

      .benefits-band p,
      .collection-grid p {
        color: #cfc5b2;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.86rem;
        line-height: 1.45;
        margin-top: 0.35rem;
      }

      .collections-section,
      .featured-section,
      .brand-story,
      .ecosystem-link,
      .boutique-cta {
        margin-top: clamp(1.2rem, 4vw, 2.4rem);
      }

      .section-heading {
        margin: 0 auto 1rem;
        max-width: 48rem;
        text-align: center;
      }

      .section-heading h2,
      .brand-story h2,
      .ecosystem-link h2,
      .boutique-cta h2 {
        color: #fff2d2;
        font-size: clamp(1.75rem, 4vw, 3.1rem);
        line-height: 1;
        margin-top: 0.35rem;
      }

      .section-heading p:last-child {
        margin-top: 0.45rem;
      }

      .collection-grid,
      .featured-grid {
        display: grid;
        gap: 0.85rem;
      }

      .collection-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .collection-grid article {
        display: grid;
        gap: 0.75rem;
        min-height: 17rem;
        padding: 1rem;
      }

      .collection-grid article > span {
        background:
          radial-gradient(
            circle at 34% 34%,
            rgb(255 232 166 / 30%),
            transparent 3.4rem
          ),
          linear-gradient(135deg, #090909, #2c210f);
        border: 1px solid rgb(244 201 87 / 24%);
        min-height: 6.4rem;
      }

      .collection-grid .ember > span {
        background:
          radial-gradient(
            circle at 68% 24%,
            rgb(228 119 48 / 28%),
            transparent 3.2rem
          ),
          linear-gradient(135deg, #080808, #2d1307);
      }

      .collection-grid .stone > span {
        background:
          radial-gradient(
            circle at 28% 30%,
            rgb(244 201 87 / 18%),
            transparent 3rem
          ),
          linear-gradient(135deg, #060606, #1f2022);
      }

      .collection-grid .royal > span {
        background:
          radial-gradient(
            circle at 62% 32%,
            rgb(244 201 87 / 24%),
            transparent 3.1rem
          ),
          linear-gradient(135deg, #090908, #33250e);
      }

      .collection-grid a {
        align-self: end;
        justify-self: start;
      }

      .featured-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .universe-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        justify-content: center;
      }

      .universe-filters button {
        background: #151619;
        border: 1px solid rgb(244 201 87 / 42%);
        border-radius: 999px;
        color: #fff1c8;
        cursor: pointer;
        font-family: 'Trebuchet MS', sans-serif;
        font-weight: 700;
        min-height: 2.75rem;
        padding: 0.6rem 1.1rem;
      }

      .universe-filters button[aria-pressed='true'] {
        background: #ffe08a;
        color: #101114;
      }

      .selection-count {
        color: #d8cfbe;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.85rem;
        margin: 0.85rem 0;
        text-align: center;
      }

      .featured-section {
        scroll-margin-top: 7rem;
      }

      a:focus-visible,
      .universe-filters button:focus-visible,
      .featured-section:focus-visible {
        outline: 3px solid #ffe08a;
        outline-offset: 4px;
      }

      .featured-note,
      .selection-empty {
        color: #d8cfbe;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.9rem;
        line-height: 1.5;
        margin-top: 1rem;
        text-align: center;
      }

      .selection-empty {
        grid-column: 1 / -1;
      }

      .brand-story {
        align-items: center;
        display: grid;
        gap: clamp(1rem, 4vw, 2rem);
        grid-template-columns: minmax(0, 1.15fr) minmax(16rem, 0.85fr);
        padding: clamp(1.25rem, 4vw, 2.2rem);
      }

      .brand-story p {
        margin-top: 0.75rem;
      }

      .brand-story a {
        margin-top: 1rem;
      }

      .brand-story blockquote {
        border-left: 2px solid rgb(244 201 87 / 66%);
        color: #ffe6a6;
        font-size: clamp(1.55rem, 4vw, 2.9rem);
        line-height: 1.05;
        padding-left: 1rem;
        text-shadow: 0 0 24px rgb(244 201 87 / 14%);
      }

      .ecosystem-link,
      .boutique-cta,
      .boutique-footer {
        padding: clamp(1.1rem, 3vw, 1.65rem);
      }

      .ecosystem-link {
        max-width: 62rem;
      }

      .ecosystem-link p:last-child,
      .boutique-cta p {
        margin-top: 0.6rem;
      }

      .boutique-cta {
        align-items: center;
        display: grid;
        justify-items: center;
        text-align: center;
      }

      .boutique-cta div {
        justify-content: center;
      }

      .boutique-footer {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        margin-bottom: 1rem;
        margin-top: clamp(1.2rem, 4vw, 2rem);
      }

      .boutique-footer > span {
        color: var(--gold-400);
        font-size: 1.6rem;
      }

      .boutique-footer strong {
        color: #fff2d2;
      }

      @media (max-width: 1160px) {
        .benefits-band,
        .featured-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .collection-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 760px) {
        .boutique-hero {
          min-height: auto;
          padding-bottom: 3rem;
          padding-top: 3rem;
        }

        .boutique-background {
          object-position: 58% center;
          opacity: 0.72;
        }

        .boutique-veil {
          background:
            radial-gradient(
              circle at 50% 28%,
              rgb(0 0 0 / 92%) 0 13rem,
              rgb(0 0 0 / 72%) 29rem
            ),
            linear-gradient(
              180deg,
              rgb(0 0 0 / 56%) 0%,
              rgb(0 0 0 / 16%) 42%,
              #070809 100%
            );
        }

        .boutique-hero-inner {
          width: 100%;
        }

        .benefits-band,
        .collection-grid,
        .brand-story {
          grid-template-columns: 1fr;
        }

        .hero-actions a,
        .boutique-cta a {
          width: 100%;
        }
      }

      @media (max-width: 520px) {
        .featured-grid {
          grid-template-columns: 1fr;
        }

        .boutique-hero,
        .benefits-band,
        .collections-section,
        .featured-section,
        .brand-story,
        .ecosystem-link,
        .boutique-cta,
        .boutique-footer {
          margin-left: 0.85rem;
          margin-right: 0.85rem;
        }

        .boutique-hero {
          margin-left: 0;
          margin-right: 0;
          padding-left: 0.85rem;
          padding-right: 0.85rem;
        }

        .benefits-band article {
          grid-template-columns: 1fr;
        }

        .boutique-footer {
          align-items: start;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.01ms !important;
        }
      }
    `
  ]
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
