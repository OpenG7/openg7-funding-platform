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
  FundTransparencyPublicResponse,
  PublicBuilderProfile
} from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundTransparencyService } from '../../services/fund-transparency.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

const emptyReport = (): FundTransparencyPublicResponse => ({
  data_source: 'empty',
  total_received: 0,
  total_fees: 0,
  total_net: 0,
  total_refunded: 0,
  total_payouts: 0,
  current_available_estimate: 0,
  contributions_count: 0,
  currency: 'CAD',
  monthly_summary: [],
  latest_public_allocations: [],
  public_builders: [],
  last_updated_at: new Date().toISOString()
});

@Component({
  selector: 'openg7-builders-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="builders-directory-shell">
      <openg7-funding-header></openg7-funding-header>

      <section class="builders-directory-hero" aria-labelledby="builders-directory-title">
        <img
          src="assets/fonds-des-batisseurs-dragon-coffre-lumineux.png"
          [alt]="'funding.buildersPage.hero.imageAlt' | translate"
        />
        <div class="hero-overlay" aria-hidden="true"></div>
        <article>
          <span>{{ 'funding.buildersPage.hero.kicker' | translate }}</span>
          <h1 id="builders-directory-title">
            {{ 'funding.buildersPage.hero.title' | translate }}
          </h1>
          <p>{{ 'funding.buildersPage.hero.copy' | translate }}</p>
          <div class="hero-actions">
            <a [routerLink]="fundPath()" fragment="support">
              {{ 'funding.nav.supportCta' | translate }}
            </a>
            <a [routerLink]="transparencyPath()">
              {{ 'funding.nav.transparency' | translate }}
            </a>
          </div>
        </article>
      </section>

      <section class="builders-directory-content" aria-labelledby="public-builders-title">
        <aside class="builders-summary" [attr.aria-label]="'funding.buildersPage.summary.ariaLabel' | translate">
          <dl>
            <div>
              <dt>{{ 'funding.buildersPage.summary.confirmed' | translate }}</dt>
              <dd>{{ formatMoney(report().total_received) }}</dd>
            </div>
            <div>
              <dt>{{ 'funding.buildersPage.summary.count' | translate }}</dt>
              <dd>{{ report().contributions_count }}</dd>
            </div>
            <div>
              <dt>{{ 'funding.home.purpose.source' | translate }}</dt>
              <dd>{{ sourceLabel() }}</dd>
            </div>
          </dl>
        </aside>

        <section class="public-builders-panel">
          <header>
            <span>{{ 'funding.buildersPage.directory.kicker' | translate }}</span>
            <h2 id="public-builders-title">
              {{ 'funding.buildersPage.directory.title' | translate }}
            </h2>
            <p>{{ 'funding.buildersPage.directory.copy' | translate }}</p>
          </header>

          <p class="state" *ngIf="loading()">
            {{ 'funding.buildersPage.state.loading' | translate }}
          </p>
          <p class="state state-error" *ngIf="error()">
            {{ 'funding.buildersPage.state.error' | translate }}
          </p>

          <ul class="builders-list" *ngIf="publicBuilders().length > 0">
            <li *ngFor="let builder of publicBuilders()">
              <span class="builder-avatar" aria-hidden="true">
                {{ initials(builder.display_name) }}
              </span>
              <div>
                <strong>{{ builder.display_name }}</strong>
                <small>{{ contributionTypeLabel(builder.contribution_type) }}</small>
              </div>
              <em>{{ amountLabel(builder) }}</em>
            </li>
          </ul>

          <article
            class="empty-builders"
            *ngIf="!loading() && !error() && publicBuilders().length === 0"
          >
            <h3>{{ 'funding.buildersPage.empty.title' | translate }}</h3>
            <p>{{ 'funding.buildersPage.empty.copy' | translate }}</p>
            <a [routerLink]="transparencyPath()">
              {{ 'funding.buildersPage.empty.action' | translate }}
            </a>
          </article>
        </section>
      </section>
    </main>
  `,
  styles: [
    `
      .builders-directory-shell {
        background: #030811;
        color: #f7fbff;
        min-height: 100vh;
      }

      .builders-directory-hero {
        display: grid;
        min-height: 31rem;
        overflow: hidden;
        position: relative;
      }

      .builders-directory-hero img,
      .hero-overlay,
      .builders-directory-hero article {
        grid-area: 1 / 1;
      }

      .builders-directory-hero img {
        height: 100%;
        object-fit: cover;
        width: 100%;
      }

      .hero-overlay {
        background: linear-gradient(90deg, rgb(2 8 18 / 94%), rgb(2 8 18 / 54%), rgb(2 8 18 / 88%));
      }

      .builders-directory-hero article {
        align-self: end;
        max-width: 47rem;
        padding: clamp(6rem, 12vw, 10rem) clamp(1rem, 5vw, 4rem) 3rem;
        position: relative;
        z-index: 1;
      }

      .builders-directory-hero span,
      .public-builders-panel header span {
        color: #f4c957;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .builders-directory-hero h1 {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.35rem, 6vw, 5.2rem);
        line-height: 0.96;
        margin: 0.65rem 0 1rem;
      }

      .builders-directory-hero p,
      .public-builders-panel p,
      .empty-builders p {
        color: #cfe0ef;
        font-family: 'Trebuchet MS', sans-serif;
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
      .empty-builders a {
        align-items: center;
        border: 1px solid rgb(244 201 87 / 42%);
        border-radius: 0.45rem;
        color: #fff4d6;
        display: inline-flex;
        font-family: 'Trebuchet MS', sans-serif;
        font-weight: 800;
        min-height: 2.65rem;
        padding: 0 0.9rem;
        text-decoration: none;
      }

      .hero-actions a:first-child {
        background: linear-gradient(135deg, #f4b53c, #ffe39a);
        color: #07101b;
      }

      .builders-directory-content {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(16rem, 0.45fr) minmax(0, 1fr);
        padding: clamp(1rem, 4vw, 3rem);
      }

      .builders-summary,
      .public-builders-panel,
      .empty-builders {
        background: rgb(3 19 38 / 82%);
        border: 1px solid rgb(102 177 232 / 28%);
        border-radius: 0.62rem;
        box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%), 0 12px 34px rgb(0 0 0 / 26%);
      }

      .builders-summary {
        align-self: start;
        padding: 1rem;
      }

      .builders-summary dl {
        display: grid;
        gap: 0.8rem;
        margin: 0;
      }

      .builders-summary dt,
      .builders-summary dd {
        margin: 0;
      }

      .builders-summary dt {
        color: #9fb7cb;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.75rem;
      }

      .builders-summary dd {
        color: #fff2cf;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 1.15rem;
        font-weight: 900;
        margin-top: 0.1rem;
      }

      .public-builders-panel {
        display: grid;
        gap: 1rem;
        padding: clamp(1rem, 3vw, 1.5rem);
      }

      .public-builders-panel h2 {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(1.65rem, 3vw, 2.5rem);
        margin: 0.35rem 0 0.5rem;
      }

      .builders-list {
        display: grid;
        gap: 0.62rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .builders-list li {
        align-items: center;
        background: rgb(5 21 42 / 82%);
        border: 1px solid rgb(122 223 255 / 20%);
        border-radius: 0.55rem;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: auto minmax(0, 1fr) auto;
        min-height: 4.2rem;
        padding: 0.68rem;
      }

      .builder-avatar {
        align-items: center;
        background: linear-gradient(160deg, #2f9fe5, #f4b53c);
        border-radius: 999px;
        color: #fff;
        display: inline-flex;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.78rem;
        font-weight: 900;
        height: 2.25rem;
        justify-content: center;
        width: 2.25rem;
      }

      .builders-list strong,
      .builders-list small {
        display: block;
        font-family: 'Trebuchet MS', sans-serif;
      }

      .builders-list strong {
        color: #f7fbff;
      }

      .builders-list small {
        color: #9fb7cb;
        font-size: 0.78rem;
        margin-top: 0.1rem;
      }

      .builders-list em {
        color: #f4c957;
        font-family: 'Trebuchet MS', sans-serif;
        font-style: normal;
        font-weight: 900;
      }

      .empty-builders {
        padding: 1rem;
      }

      .empty-builders h3 {
        color: #fff2cf;
        font-size: 1rem;
        margin: 0 0 0.45rem;
      }

      .empty-builders a {
        margin-top: 0.8rem;
      }

      .state {
        color: #cfe0ef;
        font-family: 'Trebuchet MS', sans-serif;
      }

      .state-error {
        color: #ffb5a8;
      }

      @media (max-width: 860px) {
        .builders-directory-content {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class BuildersPageComponent implements OnInit {
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly seo = inject(FundingSeoService);
  private readonly transparency = inject(FundTransparencyService);

  readonly data = signal<FundTransparencyPublicResponse | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<boolean>(false);
  readonly report = computed(() => this.data() ?? emptyReport());
  readonly publicBuilders = computed(() => this.report().public_builders);

  readonly fundPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs')
  );
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );

  constructor() {
    this.seo.bind(
      {
        titleKey: 'funding.seo.builders.title',
        descriptionKey: 'funding.seo.builders.description',
        path: '/batisseurs',
        imagePath: '/assets/fonds-des-batisseurs-dragon-coffre-lumineux.png'
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
      this.data.set(await this.transparency.getPublicTransparency());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  formatMoney(amount: number): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: this.report().currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  sourceLabel(): string {
    const source = this.report().data_source;
    if (source === 'database') {
      return 'PostgreSQL';
    }

    if (source === 'stripe_direct') {
      return 'Stripe direct';
    }

    return this.i18n.t('funding.home.sync.pending');
  }

  contributionTypeLabel(type: PublicBuilderProfile['contribution_type']): string {
    return type === 'sponsorship_interest'
      ? this.i18n.t('funding.buildersPage.directory.sponsorship')
      : this.i18n.t('funding.buildersPage.directory.personal');
  }

  amountLabel(builder: PublicBuilderProfile): string {
    return builder.amount === null
      ? this.i18n.t('funding.buildersPage.directory.amountHidden')
      : this.formatMoney(builder.amount);
  }

  initials(name: string): string {
    const parts = name.split(' ').filter(Boolean);
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }
}
