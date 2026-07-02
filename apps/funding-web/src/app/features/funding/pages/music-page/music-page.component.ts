import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';

interface NewsPreview {
  readonly title: string;
  readonly summary: string;
  readonly tone: 'ember' | 'gold' | 'charcoal';
}

@Component({
  selector: 'openg7-music-page',
  standalone: true,
  imports: [CommonModule, RouterLink, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="music-page">
      <openg7-funding-header></openg7-funding-header>

      <section class="music-stage" aria-labelledby="music-title">
        <img
          class="music-background"
          src="assets/openg7-background-dragon-forteresse-or.png"
          alt="Dragon doré et forteresse lumineuse dans l'univers OpenG7"
        />
        <div class="music-veils" aria-hidden="true"></div>

        <div class="music-shell">
          <section class="music-hero-panel" aria-describedby="music-intro">
            <p class="music-kicker">L’univers musical OpenG7</p>
            <h1 id="music-title">Les Chants du Dragon</h1>
            <p id="music-intro" class="music-lead">
              Des chants nés de la foi, de la résilience, de la création et de l’unité. Une nouvelle expérience musicale prendra
              bientôt vie au cœur d’OpenG7.
            </p>
            <span class="coming-badge">
              <span aria-hidden="true">♪</span>
              À venir
            </span>
          </section>

          <div class="music-preview-grid">
            <section class="album-card" aria-labelledby="album-title">
              <div class="album-cover" aria-hidden="true">
                <span>♬</span>
              </div>
              <div class="album-copy">
                <p class="card-eyebrow">Album</p>
                <h2 id="album-title">Premier album OpenG7</h2>
                <strong>En préparation</strong>
                <ul class="track-lines" aria-label="Aperçu des titres en préparation">
                  <li *ngFor="let track of previewTracks; let index = index">
                    <span>{{ index + 1 }}</span>
                    <i aria-hidden="true"></i>
                  </li>
                </ul>
                <button type="button" disabled aria-disabled="true">Écouter l’album — À venir</button>
              </div>
            </section>

            <section class="kingdom-news" aria-labelledby="news-title">
              <header>
                <p class="card-eyebrow">Actualités</p>
                <h2 id="news-title">Les nouvelles du Royaume</h2>
                <p>
                  Les publications, annonces, créations et nouvelles de la communauté OpenG7 seront bientôt réunies ici.
                </p>
              </header>

              <div class="news-preview-list">
                <article *ngFor="let item of newsPreviews">
                  <div class="news-visual" [class]="item.tone" aria-hidden="true"></div>
                  <span>Bientôt</span>
                  <h3>{{ item.title }}</h3>
                  <p>{{ item.summary }}</p>
                </article>
              </div>
            </section>
          </div>

          <section class="music-cta" aria-labelledby="music-cta-title">
            <h2 id="music-cta-title">Le Dragon prépare ses chants.</h2>
            <p>Revenez bientôt pour découvrir les premières œuvres musicales d’OpenG7.</p>
            <div>
              <a routerLink="/">Retour à l’accueil</a>
              <a routerLink="/ecosystem">Découvrir l’écosystème</a>
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
        background: #050505;
        color: var(--text-main);
        font-family: Georgia, 'Times New Roman', serif;
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
          radial-gradient(circle at 50% 34%, rgb(0 0 0 / 88%) 0 18rem, rgb(0 0 0 / 48%) 33rem, transparent 58rem),
          linear-gradient(90deg, rgb(0 0 0 / 22%) 0%, rgb(0 0 0 / 76%) 32%, rgb(0 0 0 / 82%) 54%, rgb(0 0 0 / 28%) 100%),
          linear-gradient(180deg, rgb(0 0 0 / 44%) 0%, rgb(0 0 0 / 8%) 42%, rgb(0 0 0 / 86%) 100%);
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
        background: radial-gradient(circle, rgb(244 201 87 / 20%), transparent 23rem);
        height: 34rem;
        left: 50%;
        top: 5rem;
        transform: translateX(-50%);
        width: 44rem;
      }

      .music-stage::after {
        border: 1px solid rgb(244 201 87 / 22%);
        inset: clamp(0.7rem, 2vw, 1.5rem);
      }

      .music-shell {
        display: grid;
        gap: clamp(1rem, 2.5vw, 1.6rem);
        margin: 0 auto;
        max-width: 1180px;
        min-height: inherit;
        padding: clamp(2.1rem, 5vw, 4.6rem) clamp(1rem, 4vw, 3.5rem) 2.4rem;
        position: relative;
      }

      .music-hero-panel,
      .album-card,
      .kingdom-news,
      .music-cta {
        backdrop-filter: blur(14px);
        background:
          linear-gradient(180deg, rgb(12 11 9 / 78%), rgb(4 4 4 / 66%)),
          rgb(8 8 8 / 70%);
        border: 1px solid rgb(244 201 87 / 38%);
        box-shadow: inset 0 1px 0 rgb(255 235 168 / 11%), 0 24px 70px rgb(0 0 0 / 36%);
      }

      .music-hero-panel {
        justify-self: center;
        max-width: 48rem;
        padding: clamp(1.45rem, 4vw, 2.7rem);
        text-align: center;
      }

      .music-kicker,
      .card-eyebrow {
        color: #f7d987;
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
      p {
        margin: 0;
      }

      h1 {
        color: #fff4d0;
        font-size: clamp(2.7rem, 7vw, 6.1rem);
        line-height: 0.9;
        margin-top: 0.6rem;
        text-shadow: 0 0 34px rgb(244 201 87 / 16%), 0 8px 34px rgb(0 0 0 / 72%);
      }

      .music-lead {
        color: #f2e6c8;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: clamp(1rem, 2vw, 1.18rem);
        line-height: 1.55;
        margin: 1.1rem auto 0;
        max-width: 41rem;
      }

      .coming-badge {
        align-items: center;
        background: rgb(91 63 15 / 38%);
        border: 1px solid rgb(244 201 87 / 74%);
        border-radius: 999px;
        box-shadow: 0 0 26px rgb(244 201 87 / 16%);
        color: #ffe8a6;
        display: inline-flex;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.95rem;
        font-weight: 900;
        gap: 0.45rem;
        margin-top: 1.25rem;
        padding: 0.55rem 0.95rem;
        text-transform: uppercase;
      }

      .music-preview-grid {
        display: grid;
        gap: clamp(1rem, 2vw, 1.35rem);
        grid-template-columns: minmax(18rem, 0.85fr) minmax(26rem, 1.15fr);
      }

      .album-card,
      .kingdom-news {
        border-radius: 0.8rem;
        padding: clamp(1rem, 2.4vw, 1.35rem);
      }

      .album-card {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(9rem, 0.82fr) minmax(12rem, 1fr);
      }

      .album-cover {
        aspect-ratio: 1;
        background:
          radial-gradient(circle at 52% 46%, rgb(255 225 140 / 18%), transparent 3.4rem),
          conic-gradient(from 24deg, #090806, #1f1609, #d6a74d, #17100a, #050505, #090806);
        border: 1px solid rgb(244 201 87 / 52%);
        box-shadow: inset 0 0 0 1px rgb(255 239 187 / 12%), 0 18px 44px rgb(0 0 0 / 32%);
        display: grid;
        min-width: 0;
        place-items: center;
      }

      .album-cover span {
        align-items: center;
        background: rgb(0 0 0 / 56%);
        border: 1px solid rgb(244 201 87 / 42%);
        border-radius: 999px;
        color: #ffe6a3;
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
        color: #fff2c8;
        font-size: clamp(1.35rem, 3vw, 2.05rem);
        line-height: 1.05;
        margin-top: 0.35rem;
      }

      .album-copy strong {
        color: #d9c18c;
        display: inline-block;
        font-family: 'Trebuchet MS', sans-serif;
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
        color: #b99a50;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.75rem;
        font-weight: 900;
      }

      .track-lines i {
        background: linear-gradient(90deg, rgb(244 201 87 / 48%), rgb(244 201 87 / 10%));
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
        background: rgb(68 54 26 / 58%);
        border: 1px solid rgb(244 201 87 / 34%);
        border-radius: 0.55rem;
        color: rgb(255 232 166 / 68%);
        cursor: not-allowed;
        font-family: 'Trebuchet MS', sans-serif;
        font-weight: 900;
        min-height: 2.75rem;
        padding: 0 1rem;
        width: 100%;
      }

      .kingdom-news header > p:last-child,
      .music-cta p,
      .news-preview-list p {
        color: #d8ceb9;
        font-family: 'Trebuchet MS', sans-serif;
        line-height: 1.5;
      }

      .kingdom-news header > p:last-child {
        margin-top: 0.55rem;
      }

      .news-preview-list {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-top: 1rem;
      }

      .news-preview-list article {
        background: rgb(3 3 3 / 54%);
        border: 1px solid rgb(244 201 87 / 24%);
        display: grid;
        gap: 0.5rem;
        min-height: 13.4rem;
        padding: 0.7rem;
      }

      .news-visual {
        background: linear-gradient(135deg, #080705, #1a1308 48%, #4f3510);
        border: 1px solid rgb(244 201 87 / 22%);
        min-height: 4.8rem;
      }

      .news-visual.ember {
        background: radial-gradient(circle at 72% 28%, rgb(244 201 87 / 34%), transparent 3rem), linear-gradient(135deg, #080705, #311406);
      }

      .news-visual.gold {
        background: radial-gradient(circle at 24% 30%, rgb(255 232 166 / 24%), transparent 3.2rem), linear-gradient(135deg, #0b0905, #4a350e);
      }

      .news-visual.charcoal {
        background: radial-gradient(circle at 62% 38%, rgb(244 201 87 / 18%), transparent 3.4rem), linear-gradient(135deg, #050505, #171717);
      }

      .news-preview-list article > span {
        align-self: start;
        border: 1px solid rgb(244 201 87 / 42%);
        border-radius: 999px;
        color: #ffe7a7;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.68rem;
        font-weight: 900;
        justify-self: start;
        padding: 0.22rem 0.5rem;
        text-transform: uppercase;
      }

      .news-preview-list h3 {
        color: #fff2cf;
        font-size: 1rem;
        line-height: 1.15;
      }

      .news-preview-list p {
        font-size: 0.82rem;
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
        border: 1px solid rgb(244 201 87 / 48%);
        border-radius: 0.5rem;
        color: #fff0c4;
        display: inline-flex;
        font-family: 'Trebuchet MS', sans-serif;
        font-weight: 900;
        justify-content: center;
        min-height: 2.7rem;
        padding: 0 1.1rem;
        text-decoration: none;
      }

      .music-cta a:first-child {
        background: linear-gradient(180deg, #ffe08a 0%, #d99b2e 100%);
        border-color: #ffe69a;
        color: #09111c;
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
          background:
            radial-gradient(circle at 50% 26%, rgb(0 0 0 / 92%) 0 14rem, rgb(0 0 0 / 72%) 30rem),
            linear-gradient(180deg, rgb(0 0 0 / 58%) 0%, rgb(0 0 0 / 22%) 45%, rgb(0 0 0 / 90%) 100%);
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
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  readonly previewTracks = [1, 2, 3, 4];

  readonly newsPreviews: readonly NewsPreview[] = [
    {
      title: 'Annonce royale',
      summary: 'Un espace dédié aux grandes annonces du projet se prépare.',
      tone: 'ember'
    },
    {
      title: 'Carnet de création',
      summary: 'Les coulisses des chants et des visuels seront bientôt partagées.',
      tone: 'gold'
    },
    {
      title: 'Voix de la communauté',
      summary: 'Les nouvelles de la communauté OpenG7 seront réunies ici.',
      tone: 'charcoal'
    }
  ];

  constructor() {
    this.title.setTitle('Les Chants du Dragon | OpenG7');
    this.meta.updateTag({
      name: 'description',
      content: 'Découvrez bientôt l’univers musical d’OpenG7, ses chants, ses créations et les nouvelles du Royaume.'
    });
  }
}