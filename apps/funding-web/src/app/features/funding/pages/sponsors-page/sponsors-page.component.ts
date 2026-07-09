import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  PublicSponsorshipProfile,
  PublicSponsorshipsResponse,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget
} from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';
import { SponsorshipsService } from '../../services/sponsorships.service.js';

const emptySponsorships = (): PublicSponsorshipsResponse => ({
  data_source: 'empty',
  sponsorships: [],
  last_updated_at: new Date().toISOString()
});

@Component({
  selector: 'openg7-sponsors-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="sponsors-shell">
      <openg7-funding-header></openg7-funding-header>

      <section class="sponsors-hero" aria-labelledby="sponsors-title">
        <img
          src="assets/openg7-social-communautes-connectees-canada.png"
          [alt]="'funding.sponsorsPage.hero.imageAlt' | translate"
        />
        <div class="hero-overlay" aria-hidden="true"></div>
        <article>
          <span>{{ 'funding.sponsorsPage.hero.kicker' | translate }}</span>
          <h1 id="sponsors-title">
            {{ 'funding.sponsorsPage.hero.title' | translate }}
          </h1>
          <p>{{ 'funding.sponsorsPage.hero.copy' | translate }}</p>
          <div class="hero-actions">
            <a [routerLink]="fundPath()" fragment="support">
              {{ 'funding.nav.supportCta' | translate }}
            </a>
            <a [routerLink]="buildersPath()">
              {{ 'funding.nav.builders' | translate }}
            </a>
          </div>
        </article>
      </section>

      <section class="sponsors-content" aria-labelledby="sponsors-list-title">
        <aside
          class="sponsors-summary"
          [attr.aria-label]="'funding.sponsorsPage.summary.ariaLabel' | translate"
        >
          <dl>
            <div>
              <dt>{{ 'funding.sponsorsPage.summary.approved' | translate }}</dt>
              <dd>{{ sponsorships().length }}</dd>
            </div>
            <div>
              <dt>{{ 'funding.sponsorsPage.summary.feedReady' | translate }}</dt>
              <dd>{{ feedReadyCount() }}</dd>
            </div>
            <div>
              <dt>{{ 'funding.home.purpose.source' | translate }}</dt>
              <dd>{{ sourceLabel() }}</dd>
            </div>
          </dl>
        </aside>

        <section class="sponsors-panel">
          <header>
            <span>{{ 'funding.sponsorsPage.directory.kicker' | translate }}</span>
            <h2 id="sponsors-list-title">
              {{ 'funding.sponsorsPage.directory.title' | translate }}
            </h2>
            <p>{{ 'funding.sponsorsPage.directory.copy' | translate }}</p>
          </header>

          <p class="state" *ngIf="loading()">
            {{ 'funding.sponsorsPage.state.loading' | translate }}
          </p>
          <p class="state state-error" *ngIf="error()">
            {{ 'funding.sponsorsPage.state.error' | translate }}
          </p>

          <ul class="sponsors-list" *ngIf="sponsorships().length > 0">
            <li
              *ngFor="let sponsor of sponsorships(); trackBy: trackBySponsor"
            >
              <a
                *ngIf="sponsor.logo_url; else sponsorInitials"
                class="sponsor-logo"
                [href]="sponsor.website_url || sponsor.logo_url"
                target="_blank"
                rel="noreferrer"
              >
                <img [src]="sponsor.logo_url" [alt]="sponsor.company_name" />
              </a>
              <ng-template #sponsorInitials>
                <span class="sponsor-logo sponsor-initials" aria-hidden="true">
                  {{ initials(sponsor.company_name) }}
                </span>
              </ng-template>

              <div class="sponsor-body">
                <div class="sponsor-title-row">
                  <div>
                    <strong>{{ sponsor.company_name }}</strong>
                    <small>{{ amountLabel(sponsor) }}</small>
                  </div>
                  <span
                    class="feed-status"
                    [class.feed-status-muted]="sponsor.feed_status === 'not_planned'"
                  >
                    {{ feedStatusLabel(sponsor.feed_status) }}
                  </span>
                </div>

                <p *ngIf="sponsor.public_summary || sponsor.message">
                  {{ sponsor.public_summary || sponsor.message }}
                </p>

                <div class="feed-placement" *ngIf="hasFeedPlacement(sponsor)">
                  <span>{{ feedTargetLabel(sponsor.feed_target) }}</span>
                  <span *ngFor="let channel of sponsor.feed_channels">
                    {{ feedChannelLabel(channel) }}
                  </span>
                  <a
                    *ngIf="sponsor.feed_public_url"
                    [href]="sponsor.feed_public_url"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {{ 'funding.sponsorsPage.directory.feedLink' | translate }}
                  </a>
                </div>
              </div>

              <a
                *ngIf="sponsor.website_url"
                class="sponsor-website"
                [href]="sponsor.website_url"
                target="_blank"
                rel="noreferrer"
              >
                {{ 'funding.sponsorsPage.directory.website' | translate }}
              </a>
            </li>
          </ul>

          <article
            class="empty-sponsors"
            *ngIf="!loading() && !error() && sponsorships().length === 0"
          >
            <h3>{{ 'funding.sponsorsPage.empty.title' | translate }}</h3>
            <p>{{ 'funding.sponsorsPage.empty.copy' | translate }}</p>
            <a [routerLink]="fundPath()" fragment="support">
              {{ 'funding.sponsorsPage.empty.action' | translate }}
            </a>
          </article>
        </section>
      </section>
    </main>
  `,
  styles: [
    `
      .sponsors-shell {
        background: #07101b;
        color: #f7fbff;
        min-height: 100vh;
      }

      .sponsors-hero {
        display: grid;
        min-height: 32rem;
        overflow: hidden;
        position: relative;
      }

      .sponsors-hero img,
      .hero-overlay,
      .sponsors-hero article {
        grid-area: 1 / 1;
      }

      .sponsors-hero img {
        height: 100%;
        object-fit: cover;
        width: 100%;
      }

      .hero-overlay {
        background: linear-gradient(90deg, rgb(3 10 20 / 96%), rgb(5 22 38 / 48%), rgb(3 10 20 / 88%));
      }

      .sponsors-hero article {
        align-self: end;
        max-width: 48rem;
        padding: clamp(6rem, 12vw, 10rem) clamp(1rem, 5vw, 4rem) 3rem;
        position: relative;
        z-index: 1;
      }

      .sponsors-hero span,
      .sponsors-panel header span {
        color: #77d9e8;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .sponsors-hero h1 {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.35rem, 6vw, 5rem);
        line-height: 0.98;
        margin: 0.65rem 0 1rem;
      }

      .sponsors-hero p,
      .sponsors-panel p,
      .empty-sponsors p {
        color: #d4e4ef;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        line-height: 1.55;
        margin: 0;
      }

      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1.35rem;
      }

      .hero-actions a,
      .empty-sponsors a,
      .sponsor-website {
        align-items: center;
        border: 1px solid rgb(119 217 232 / 42%);
        border-radius: 0.45rem;
        color: #e9fbff;
        display: inline-flex;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-weight: 800;
        min-height: 2.65rem;
        padding: 0 0.9rem;
        text-decoration: none;
      }

      .hero-actions a:first-child {
        background: #f4c957;
        border-color: #f4c957;
        color: #07101b;
      }

      .sponsors-content {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(16rem, 0.38fr) minmax(0, 1fr);
        padding: clamp(1rem, 4vw, 3rem);
      }

      .sponsors-summary,
      .sponsors-panel,
      .empty-sponsors {
        background: rgb(5 22 38 / 84%);
        border: 1px solid rgb(119 217 232 / 26%);
        border-radius: 0.5rem;
        box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%), 0 12px 30px rgb(0 0 0 / 22%);
      }

      .sponsors-summary {
        align-self: start;
        padding: 1rem;
      }

      .sponsors-summary dl {
        display: grid;
        gap: 0.8rem;
        margin: 0;
      }

      .sponsors-summary dt,
      .sponsors-summary dd {
        margin: 0;
      }

      .sponsors-summary dt {
        color: #9db7c9;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.75rem;
      }

      .sponsors-summary dd {
        color: #fff2cf;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 1.15rem;
        font-weight: 900;
        margin-top: 0.1rem;
      }

      .sponsors-panel {
        display: grid;
        gap: 1rem;
        padding: clamp(1rem, 3vw, 1.5rem);
      }

      .sponsors-panel h2 {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(1.65rem, 3vw, 2.45rem);
        margin: 0.35rem 0 0.5rem;
      }

      .sponsors-list {
        display: grid;
        gap: 0.72rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .sponsors-list li {
        align-items: center;
        background: rgb(4 16 28 / 86%);
        border: 1px solid rgb(244 201 87 / 18%);
        border-radius: 0.5rem;
        display: grid;
        gap: 0.85rem;
        grid-template-columns: auto minmax(0, 1fr) auto;
        min-height: 6rem;
        padding: 0.8rem;
      }

      .sponsor-logo {
        align-items: center;
        background: #fff;
        border-radius: 0.45rem;
        display: inline-flex;
        height: 4rem;
        justify-content: center;
        overflow: hidden;
        width: 4rem;
      }

      .sponsor-logo img {
        max-height: 3rem;
        max-width: 3.3rem;
        object-fit: contain;
      }

      .sponsor-initials {
        background: linear-gradient(145deg, #2f9fe5, #f4c957);
        color: #fff;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-weight: 900;
      }

      .sponsor-body {
        display: grid;
        gap: 0.55rem;
        min-width: 0;
      }

      .sponsor-title-row {
        align-items: start;
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        justify-content: space-between;
      }

      .sponsor-title-row strong,
      .sponsor-title-row small {
        display: block;
        font-family: 'Trebuchet MS', Arial, sans-serif;
      }

      .sponsor-title-row strong {
        color: #f7fbff;
        font-size: 1.05rem;
      }

      .sponsor-title-row small {
        color: #9db7c9;
        font-size: 0.8rem;
        margin-top: 0.15rem;
      }

      .feed-status,
      .feed-placement span,
      .feed-placement a {
        border-radius: 999px;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.72rem;
        font-weight: 900;
        padding: 0.28rem 0.55rem;
        text-transform: uppercase;
      }

      .feed-status {
        background: #dff7e8;
        color: #176236;
      }

      .feed-status-muted {
        background: #eef2f7;
        color: #526070;
      }

      .feed-placement {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .feed-placement span,
      .feed-placement a {
        background: rgb(119 217 232 / 16%);
        color: #dffaff;
        text-decoration: none;
      }

      .sponsor-website {
        justify-self: end;
        min-height: 2.35rem;
      }

      .empty-sponsors {
        padding: 1rem;
      }

      .empty-sponsors h3 {
        color: #fff2cf;
        font-size: 1rem;
        margin: 0 0 0.45rem;
      }

      .empty-sponsors a {
        margin-top: 0.8rem;
      }

      .state {
        color: #d4e4ef;
        font-family: 'Trebuchet MS', Arial, sans-serif;
      }

      .state-error {
        color: #ffb5a8;
      }

      @media (max-width: 880px) {
        .sponsors-content,
        .sponsors-list li {
          grid-template-columns: 1fr;
        }

        .sponsor-logo {
          height: 3.5rem;
          width: 3.5rem;
        }

        .sponsor-website {
          justify-self: start;
        }
      }
    `
  ]
})
export class SponsorsPageComponent implements OnInit {
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly seo = inject(FundingSeoService);
  private readonly sponsorshipsService = inject(SponsorshipsService);

  readonly data = signal<PublicSponsorshipsResponse | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<boolean>(false);
  readonly report = computed(() => this.data() ?? emptySponsorships());
  readonly sponsorships = computed(() => this.report().sponsorships);
  readonly feedReadyCount = computed(
    () =>
      this.sponsorships().filter(
        (sponsor) => sponsor.feed_status !== 'not_planned'
      ).length
  );

  readonly buildersPath = computed(() => this.i18n.localizedPath('/batisseurs'));
  readonly fundPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs')
  );

  constructor() {
    this.seo.bind(
      {
        titleKey: 'funding.seo.sponsors.title',
        descriptionKey: 'funding.seo.sponsors.description',
        path: '/commanditaires',
        imagePath: '/assets/openg7-social-communautes-connectees-canada.png'
      },
      this.injector
    );
  }

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    try {
      this.data.set(await this.sponsorshipsService.getPublicSponsorships());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  trackBySponsor(_: number, sponsor: PublicSponsorshipProfile): string {
    return sponsor.public_slug || sponsor.company_name;
  }

  sourceLabel(): string {
    return this.report().data_source === 'database'
      ? 'PostgreSQL'
      : this.i18n.t('funding.home.sync.pending');
  }

  amountLabel(sponsor: PublicSponsorshipProfile): string {
    if (sponsor.amount === null) {
      return this.i18n.t('funding.sponsorsPage.directory.amountHidden');
    }

    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: sponsor.currency,
      minimumFractionDigits: Number.isInteger(sponsor.amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(sponsor.amount);
  }

  hasFeedPlacement(sponsor: PublicSponsorshipProfile): boolean {
    return (
      sponsor.feed_status !== 'not_planned' &&
      Boolean(sponsor.feed_target) &&
      sponsor.feed_channels.length > 0
    );
  }

  feedTargetLabel(target: SponsorFeedTarget | null): string {
    if (target === 'openg20') {
      return 'OpenG20';
    }

    return target === 'openg7'
      ? 'OpenG7'
      : this.i18n.t('funding.sponsorsPage.directory.feedTargetPending');
  }

  feedChannelLabel(channel: SponsorFeedChannel): string {
    return channel === 'facebook' ? 'Facebook' : 'LinkedIn';
  }

  feedStatusLabel(status: SponsorFeedStatus): string {
    return this.i18n.t(`funding.sponsorsPage.feedStatus.${status}`);
  }

  initials(name: string): string {
    const parts = name.split(' ').filter(Boolean);
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }
}
