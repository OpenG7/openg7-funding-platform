import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

interface NewsPreview {
  readonly titleKey: string;
  readonly summaryKey: string;
  readonly tone: 'ember' | 'gold' | 'charcoal';
}

@Component({
  selector: 'openg7-music-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="music-page">
      <openg7-funding-header></openg7-funding-header>

      <section class="music-stage" aria-labelledby="music-title">
        <img
          class="music-background"
          src="assets/openg7-background-dragon-forteresse-or.png"
          [alt]="'funding.musicPage.hero.backgroundAlt' | translate"
        />
        <div class="music-veils" aria-hidden="true"></div>

        <div class="music-shell">
          <section class="music-hero-panel" aria-describedby="music-intro">
            <p class="music-kicker">
              {{ 'funding.musicPage.hero.eyebrow' | translate }}
            </p>
            <h1 id="music-title">
              {{ 'funding.musicPage.hero.title' | translate }}
            </h1>
            <p id="music-intro" class="music-lead">
              {{ 'funding.musicPage.hero.copy' | translate }}
            </p>
            <span class="coming-badge">
              <span aria-hidden="true">♪</span>
              {{ 'funding.musicPage.hero.comingSoon' | translate }}
            </span>
          </section>

          <div class="music-preview-grid">
            <section class="album-card" aria-labelledby="album-title">
              <div class="album-cover" aria-hidden="true">
                <span>♬</span>
              </div>
              <div class="album-copy">
                <p class="card-eyebrow">
                  {{ 'funding.musicPage.album.eyebrow' | translate }}
                </p>
                <h2 id="album-title">
                  {{ 'funding.musicPage.album.title' | translate }}
                </h2>
                <strong>{{
                  'funding.musicPage.album.status' | translate
                }}</strong>
                <ul
                  class="track-lines"
                  [attr.aria-label]="
                    'funding.musicPage.album.trackPreviewAria' | translate
                  "
                >
                  <li *ngFor="let track of previewTracks; let index = index">
                    <span>{{ index + 1 }}</span>
                    <i aria-hidden="true"></i>
                  </li>
                </ul>
                <button type="button" disabled aria-disabled="true">
                  {{ 'funding.musicPage.album.disabledButton' | translate }}
                </button>
              </div>
            </section>

            <section class="kingdom-news" aria-labelledby="news-title">
              <header>
                <p class="card-eyebrow">
                  {{ 'funding.musicPage.news.eyebrow' | translate }}
                </p>
                <h2 id="news-title">
                  {{ 'funding.musicPage.news.title' | translate }}
                </h2>
                <p>{{ 'funding.musicPage.news.copy' | translate }}</p>
              </header>

              <div class="news-preview-list">
                <article *ngFor="let item of newsPreviews">
                  <div
                    class="news-visual"
                    [class]="item.tone"
                    aria-hidden="true"
                  ></div>
                  <span>{{ 'funding.musicPage.news.badge' | translate }}</span>
                  <h3>{{ item.titleKey | translate }}</h3>
                  <p>{{ item.summaryKey | translate }}</p>
                </article>
              </div>
            </section>
          </div>

          <section class="music-cta" aria-labelledby="music-cta-title">
            <h2 id="music-cta-title">
              {{ 'funding.musicPage.cta.title' | translate }}
            </h2>
            <p>{{ 'funding.musicPage.cta.copy' | translate }}</p>
            <div>
              <a [routerLink]="homePath()">{{
                'funding.musicPage.cta.home' | translate
              }}</a>
              <a [routerLink]="ecosystemPath()">{{
                'funding.musicPage.cta.ecosystem' | translate
              }}</a>
            </div>
          </section>
        </div>
      </section>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .music-page {
        background: var(--surface-page);
        color: var(--text-main);
        font-family: 'Segoe UI', Arial, sans-serif;
        min-height: 100dvh;
        overflow: hidden;
      }

      .music-stage {
        isolation: isolate;
        min-height: calc(100dvh - 4.15rem);
        overflow: hidden;
        position: relative;
      }

      .music-background,
      .music-veils {
        inset: 0;
        position: absolute;
      }

      .music-background {
        height: 100%;
        object-fit: cover;
        object-position: center center;
        width: 100%;
        z-index: -3;
      }

      .music-veils {
        background:
          linear-gradient(
            90deg,
            var(--surface-page) 0%,
            color-mix(in srgb, var(--surface-page) 97%, transparent) 38%,
            color-mix(in srgb, var(--surface-page) 90%, transparent) 68%,
            color-mix(in srgb, var(--surface-page) 25%, transparent)
          ),
          linear-gradient(180deg, transparent 60%, var(--surface-page));
        z-index: -2;
      }

      .music-stage::before,
      .music-stage::after {
        content: '';
        pointer-events: none;
        position: absolute;
        z-index: -1;
      }

      .music-stage::before {
        background: var(--surface-subtle);
        height: 34rem;
        left: 50%;
        top: 5rem;
        transform: translateX(-50%);
        width: 44rem;
      }

      .music-stage::after {
        border: 1px solid var(--border-color);
        inset: clamp(0.7rem, 2vw, 1.5rem);
      }

      .music-shell {
        display: grid;
        gap: 1.5rem;
        margin: 0 auto;
        max-width: 1180px;
        min-height: inherit;
        padding: 2.5rem clamp(1rem, 4vw, 3rem);
        position: relative;
      }

      .music-hero-panel,
      .album-card,
      .kingdom-news,
      .music-cta {
        backdrop-filter: none;
        background: var(--surface-panel);
        border: 1px solid var(--border-color);
        box-shadow: 0 8px 24px rgb(41 51 46 / 7%);
      }

      .music-hero-panel {
        justify-self: center;
        max-width: 48rem;
        padding: clamp(1.45rem, 4vw, 2.7rem);
        text-align: center;
      }

      .music-kicker,
      .card-eyebrow {
        color: var(--color-gold);
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 0.875rem;
        font-weight: 900;
        letter-spacing: 0;
        margin: 0;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      h1 {
        color: var(--text-main);
        font-size: clamp(2.7rem, 7vw, 2.75rem);
        line-height: 1.25;
        margin-top: 0.6rem;
        text-shadow: none;
      }

      .music-lead {
        color: var(--text-soft);
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: clamp(1rem, 2vw, 1.18rem);
        line-height: 1.55;
        margin: 1.1rem auto 0;
        max-width: 41rem;
      }

      .coming-badge {
        align-items: center;
        background: var(--surface-subtle);
        border: 1px solid var(--border-color);
        border-radius: 999px;
        box-shadow: none;
        color: var(--color-gold);
        display: inline-flex;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 0.95rem;
        font-weight: 900;
        gap: 0.45rem;
        margin-top: 1.25rem;
        padding: 0.55rem 0.95rem;
        text-transform: uppercase;
      }

      .music-preview-grid {
        display: grid;
        gap: 1.5rem;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }

      .album-card,
      .kingdom-news {
        border-radius: 0.8rem;
        padding: clamp(1rem, 2.4vw, 1.35rem);
      }

      .album-card {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 0.82fr) minmax(0, 1fr);
      }

      .album-cover {
        aspect-ratio: 1;
        background:
          radial-gradient(
            circle at 52% 46%,
            rgb(255 225 140 / 18%),
            transparent 3.4rem
          ),
          conic-gradient(
            from 24deg,
            #090806,
            #1f1609,
            #d6a74d,
            #17100a,
            #050505,
            #090806
          );
        border: 1px solid var(--border-color);
        box-shadow: 0 8px 24px rgb(41 51 46 / 7%);
        display: grid;
        min-width: 0;
        place-items: center;
      }

      .album-cover span {
        align-items: center;
        background: rgb(0 0 0 / 56%);
        border: 1px solid var(--border-color);
        border-radius: 999px;
        color: #fff4d4;
        display: inline-flex;
        font-size: clamp(2.3rem, 5vw, 3.6rem);
        height: 48%;
        justify-content: center;
        width: 48%;
      }

      .album-copy {
        min-width: 0;
      }

      .album-copy h2,
      .kingdom-news h2,
      .music-cta h2 {
        color: var(--text-main);
        font-size: clamp(1.35rem, 3vw, 2.05rem);
        line-height: 1.25;
        margin-top: 0.35rem;
      }

      .album-copy strong {
        color: var(--text-main);
        display: inline-block;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 0.88rem;
        margin-top: 0.55rem;
      }

      .track-lines {
        display: grid;
        gap: 0.55rem;
        list-style: none;
        margin: 1rem 0 1.05rem;
        padding: 0;
      }

      .track-lines li {
        align-items: center;
        display: grid;
        gap: 0.55rem;
        grid-template-columns: auto 1fr;
      }

      .track-lines span {
        color: var(--text-main);
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 0.875rem;
        font-weight: 900;
      }

      .track-lines i {
        background: var(--color-primary);
        border-radius: 999px;
        display: block;
        height: 0.52rem;
      }

      .track-lines li:nth-child(2) i {
        width: 76%;
      }

      .track-lines li:nth-child(3) i {
        width: 88%;
      }

      .track-lines li:nth-child(4) i {
        width: 64%;
      }

      .album-copy button {
        background: var(--surface-subtle);
        border: 1px solid var(--border-color);
        border-radius: 0.55rem;
        color: var(--text-soft);
        cursor: not-allowed;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-weight: 900;
        min-height: 2.75rem;
        padding: 0 1rem;
        width: 100%;
      }

      .kingdom-news header > p:last-child,
      .music-cta p,
      .news-preview-list p {
        color: var(--text-soft);
        font-family: 'Segoe UI', Arial, sans-serif;
        line-height: 1.5;
      }

      .kingdom-news header > p:last-child {
        margin-top: 0.55rem;
      }

      .news-preview-list {
        display: grid;
        gap: 1rem;
        grid-template-columns: 1fr;
        margin-top: 1rem;
      }

      .news-preview-list article {
        background: var(--surface-panel);
        border: 1px solid var(--border-color);
        display: grid;
        gap: 0.5rem;
        min-height: auto;
        padding: 1rem;
        grid-template-columns: 5rem minmax(0, 1fr);
      }

      .news-visual {
        background: var(--surface-subtle);
        border: 1px solid var(--border-color);
        min-height: 4.8rem;
        grid-row: 1 / span 3;
      }

      .news-visual.ember {
        background: var(--surface-subtle);
      }

      .news-visual.gold {
        background: var(--surface-subtle);
      }

      .news-visual.charcoal {
        background: var(--surface-subtle);
      }

      .news-preview-list article > span {
        align-self: start;
        border: 1px solid var(--border-color);
        border-radius: 999px;
        color: var(--color-gold);
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 0.875rem;
        font-weight: 900;
        justify-self: start;
        padding: 0.22rem 0.5rem;
        text-transform: uppercase;
        grid-column: 2;
      }

      .news-preview-list h3 {
        color: var(--text-main);
        font-size: 1rem;
        line-height: 1.25;
        grid-column: 2;
      }

      .news-preview-list p {
        font-size: 0.875rem;
        grid-column: 2;
      }

      .music-cta {
        align-items: center;
        border-radius: 0.8rem;
        display: grid;
        gap: 0.75rem;
        justify-items: center;
        padding: clamp(1.2rem, 3vw, 1.8rem);
        text-align: center;
      }

      .music-cta div {
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem;
        justify-content: center;
        margin-top: 0.2rem;
      }

      .music-cta a {
        align-items: center;
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        color: var(--color-primary);
        display: inline-flex;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-weight: 900;
        justify-content: center;
        min-height: 2.7rem;
        padding: 0 1.1rem;
        text-decoration: none;
      }

      .music-cta a:first-child {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: var(--on-primary);
      }

      @media (max-width: 940px) {
        .music-preview-grid,
        .album-card {
          grid-template-columns: 1fr;
        }

        .album-cover {
          max-width: 17rem;
          width: 100%;
        }
      }

      @media (max-width: 720px) {
        .music-background {
          object-position: 64% center;
          opacity: 0.72;
        }

        .music-veils {
          background: linear-gradient(
            color-mix(in srgb, var(--surface-page) 94%, transparent),
            color-mix(in srgb, var(--surface-page) 98%, transparent)
          );
        }

        .music-stage::after {
          inset: 0.55rem;
        }

        .news-preview-list {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 520px) {
        .music-shell {
          padding: 1.4rem 0.85rem 1.8rem;
        }

        .music-hero-panel,
        .album-card,
        .kingdom-news,
        .music-cta {
          border-radius: 0.62rem;
        }

        .music-cta a {
          width: 100%;
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
export class MusicPageComponent {
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);

  readonly homePath = computed(() => this.i18n.localizedPath('/'));
  readonly ecosystemPath = computed(() =>
    this.i18n.localizedPath('/ecosystem')
  );

  readonly previewTracks = [1, 2, 3, 4];

  readonly newsPreviews: readonly NewsPreview[] = [
    {
      titleKey: 'funding.musicPage.news.items.announcement.title',
      summaryKey: 'funding.musicPage.news.items.announcement.summary',
      tone: 'ember'
    },
    {
      titleKey: 'funding.musicPage.news.items.creation.title',
      summaryKey: 'funding.musicPage.news.items.creation.summary',
      tone: 'gold'
    },
    {
      titleKey: 'funding.musicPage.news.items.community.title',
      summaryKey: 'funding.musicPage.news.items.community.summary',
      tone: 'charcoal'
    }
  ];

  constructor() {
    this.seo.bind(
      {
        titleKey: 'funding.musicPage.seo.title',
        descriptionKey: 'funding.musicPage.seo.description',
        path: '/music',
        imagePath: '/assets/openg7-background-dragon-forteresse-or.png'
      },
      this.injector
    );
  }
}
