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
  styleUrl: './music-page.component.css'
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
