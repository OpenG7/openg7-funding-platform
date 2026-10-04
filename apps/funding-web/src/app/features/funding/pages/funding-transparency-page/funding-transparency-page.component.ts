import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  PLATFORM_ID,
  computed,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingTransparencyRegistryComponent } from '../../components/funding-transparency-registry/funding-transparency-registry.component.js';
import { FundingTransparencyAllocationsComponent } from '../../components/funding-transparency-allocations/funding-transparency-allocations.component.js';
import { FundingTransparencyReportsComponent } from '../../components/funding-transparency-reports/funding-transparency-reports.component.js';
import { FUNDING_PROJECT_CONFIG } from '../../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../../config/openg7-funding.config.js';
import { FundTransparencyService } from '../../services/fund-transparency.service.js';
import { FundingTransparencyController } from '../../services/funding-transparency-controller.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

@Component({
  selector: 'openg7-funding-transparency-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    FundingHeaderComponent,
    FundingTransparencyRegistryComponent,
    FundingTransparencyAllocationsComponent,
    FundingTransparencyReportsComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="transparency-dashboard">
      <openg7-funding-header />
      <section class="hero-panel" aria-labelledby="transparency-title">
        <img
          class="hero-city"
          src="assets/fonds-des-batisseurs-feuille-erable-lumineuse-960.webp"
          srcset="
            assets/fonds-des-batisseurs-feuille-erable-lumineuse-960.webp   960w,
            assets/fonds-des-batisseurs-feuille-erable-lumineuse-1920.webp 1920w
          "
          sizes="100vw"
          width="1916"
          height="821"
          alt=""
          fetchpriority="high"
        />
        <img
          class="hero-dragon"
          src="assets/fonds-des-batisseurs-dragon-coffre-fort-960.webp"
          width="1916"
          height="821"
          alt=""
          decoding="async"
        />
        <div class="hero-copy">
          <h1 id="transparency-title">
            {{ 'funding.transparencyPage.hero.title' | translate }}
            <strong>{{
              'funding.transparencyPage.hero.titleStrong' | translate
            }}</strong>
          </h1>
          <p>{{ 'funding.transparencyPage.hero.copy' | translate }}</p>
          <div class="hero-actions">
            <button type="button" (click)="transparency.scrollToRegistry()">
              {{ 'funding.transparencyPage.hero.viewRegistry' | translate }}
            </button>
            <button
              type="button"
              class="secondary"
              data-og7="transparency-json"
              [disabled]="!transparency.canExport()"
              (click)="transparency.downloadReport()"
            >
              {{ 'funding.transparencyPage.hero.downloadReport' | translate }}
            </button>
            <a class="secondary" [routerLink]="homePath()" fragment="support">{{
              'funding.nav.supportCta' | translate
            }}</a>
          </div>
        </div>
      </section>

      <div class="page-content">
        <section
          class="status-panel panel"
          aria-label="{{ 'funding.transparencyPage.sync.title' | translate }}"
        >
          <div role="status" aria-live="polite" data-og7="transparency-status">
            @if (transparency.loading()) {
              <p>{{ 'funding.transparencyPage.state.loading' | translate }}</p>
            } @else if (transparency.error()) {
              <p class="error">
                {{
                  (transparency.hasSnapshot()
                    ? 'funding.transparencyPage.state.stale'
                    : 'funding.transparencyPage.state.error'
                  ) | translate
                }}
              </p>
            } @else if (!transparency.hasSnapshot()) {
              <p>{{ 'funding.transparencyPage.state.noSource' | translate }}</p>
            } @else {
              <p>{{ 'funding.transparencyPage.state.ready' | translate }}</p>
            }
          </div>
          <button
            type="button"
            data-og7="transparency-refresh"
            [disabled]="transparency.loading()"
            (click)="transparency.refresh()"
          >
            {{
              (transparency.error()
                ? 'funding.transparencyPage.state.retry'
                : 'funding.transparencyPage.state.refresh'
              ) | translate
            }}
          </button>
          <dl class="sync-strip">
            <div>
              <dt>
                {{ 'funding.transparencyPage.sync.snapshot' | translate }}
              </dt>
              <dd data-og7="snapshot-date">
                {{
                  transparency.hasSnapshot()
                    ? formatDate(transparency.data()?.last_updated_at)
                    : '—'
                }}
              </dd>
            </div>
            <div>
              <dt>{{ 'funding.transparencyPage.sync.checked' | translate }}</dt>
              <dd data-og7="checked-date">
                {{ formatDate(transparency.checkedAt()) }}
              </dd>
            </div>
            <div>
              <dt>{{ 'funding.home.purpose.source' | translate }}</dt>
              <dd>{{ transparency.sourceLabel() }}</dd>
            </div>
            <div>
              <dt>{{ 'funding.home.purpose.currency' | translate }}</dt>
              <dd>
                {{
                  transparency.hasSnapshot()
                    ? transparency.data()?.currency
                    : '—'
                }}
              </dd>
            </div>
          </dl>
        </section>

        <section
          class="kpi-grid"
          data-og7="transparency-totals"
          [attr.aria-busy]="transparency.loading()"
          aria-label="{{
            'funding.transparencyPage.kpis.ariaLabel' | translate
          }}"
        >
          @for (card of transparency.kpiCards(); track card.label) {
            <article class="kpi-card panel" [class.net]="card.net">
              <h2>{{ card.label | translate }}</h2>
              <strong>{{
                formatMoney(card.value, transparency.data()?.currency)
              }}</strong>
              <p>{{ card.detail | translate }}</p>
              @if (card.net && transparency.hasSnapshot()) {
                <p
                  class="fee-quality"
                  [class.provisional]="
                    (transparency.data()?.pending_fee_count ?? 0) > 0
                  "
                  data-og7="fee-quality"
                >
                  {{
                    transparency.feeQualityKey()
                      | translate
                        : { count: transparency.data()?.pending_fee_count }
                  }}
                </p>
              }
            </article>
          }
        </section>

        <section class="campaign-card panel" data-og7="transparency-campaign">
          <header>
            <h2>
              {{ 'funding.transparencyPage.campaign.progress' | translate }}
              <span>{{ transparency.currentMonth() }} (UTC)</span>
            </h2>
            <strong>{{
              transparency.monthlyProgress() === null
                ? '—'
                : transparency.monthlyProgress() + '%'
            }}</strong>
          </header>
          <div
            class="campaign-track"
            role="progressbar"
            aria-label="{{
              'funding.transparencyPage.campaign.progress' | translate
            }}"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="transparency.monthlyProgress()"
          >
            <span [style.width.%]="transparency.monthlyProgress() ?? 0"></span>
          </div>
          <p>
            <span data-og7="monthly-received">{{
              formatMoney(transparency.currentMonthReceived())
            }}</span>
            /
            {{ formatMoney(config.monthlyGoal) }}
            · {{ 'funding.transparencyPage.campaign.goal' | translate }}
          </p>
          @if (transparency.remainingForGoal() !== null) {
            <p>
              {{ formatMoney(transparency.remainingForGoal()) }}
              {{ 'funding.transparencyPage.campaign.remaining' | translate }}
            </p>
          }
          @if (
            transparency.hasSnapshot() &&
            transparency.currentMonthReceived() === null
          ) {
            <p role="status">
              {{ 'funding.transparencyPage.campaign.unavailable' | translate }}
            </p>
          }
          <p class="fine-print">
            {{ 'funding.transparencyPage.campaign.scope' | translate }}
          </p>
        </section>

        <section class="dashboard-grid">
          <openg7-funding-transparency-registry
            [monthlySummary]="transparency.data()?.monthly_summary ?? []"
            [availableMonths]="transparency.availableMonths()"
            [period]="transparency.period()"
            [filter]="transparency.registryFilter()"
            [hasSnapshot]="transparency.hasSnapshot()"
            [loading]="transparency.loading()"
            [periodUnavailable]="transparency.periodUnavailable()"
            [formatMoney]="formatPublicMoney"
            (periodChange)="transparency.selectPeriod($event)"
            (filterChange)="transparency.selectFilter($event)"
          />
          <openg7-funding-transparency-allocations
            [allocations]="transparency.publicAllocations()"
            [hasSnapshot]="transparency.hasSnapshot()"
            [aboutPath]="aboutPath()"
            [formatMoney]="formatPublicMoney"
            [formatDate]="formatPublicDate"
          />
          <openg7-funding-transparency-reports
            [period]="transparency.period()"
            [canExport]="transparency.canExport()"
            [copyState]="transparency.copyState()"
            (action)="transparency.handleReportAction($event)"
          />

          <article class="panel privacy-panel">
            <h2>{{ 'funding.transparencyPage.privacy.title' | translate }}</h2>
            <p>{{ 'funding.transparencyPage.privacy.copy' | translate }}</p>
            <a [routerLink]="policyPath()">{{
              'funding.transparencyPage.privacy.policy' | translate
            }}</a>
          </article>

          <article class="panel platforms-panel">
            <h2>
              {{ 'funding.transparencyPage.platforms.title' | translate }}
            </h2>
            <p>{{ 'funding.transparencyPage.platforms.copy' | translate }}</p>
            <a [routerLink]="ecosystemPath()" fragment="platforms">{{
              'funding.transparencyPage.platforms.link' | translate
            }}</a>
          </article>
        </section>

        <section id="support" class="support-strip panel">
          <div>
            <h2>{{ 'funding.transparencyPage.support.title' | translate }}</h2>
            <p>{{ 'funding.transparencyPage.support.copy' | translate }}</p>
          </div>
          <a class="support-cta" [routerLink]="homePath()" fragment="support">{{
            'funding.nav.supportCta' | translate
          }}</a>
        </section>
        <footer class="page-footer">
          <a
            [routerLink]="homePath()"
            [attr.aria-label]="'funding.aria.brandHome' | translate"
            ><strong>OpenG7</strong></a
          >
          <nav
            [attr.aria-label]="
              'funding.ecosystemPage.footer.secondaryLinksAria' | translate
            "
          >
            <a [routerLink]="aboutPath()">{{
              'funding.nav.about' | translate
            }}</a>
            <a [routerLink]="ecosystemPath()">{{
              'funding.nav.ecosystem' | translate
            }}</a>
            <a [routerLink]="supportPath()">{{
              'funding.nav.contact' | translate
            }}</a>
          </nav>
          <small>{{
            'funding.ecosystemPage.footer.copyright'
              | translate: { year: currentYear }
          }}</small>
        </footer>
      </div>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
      background: #020914;
      color: #e9f2ff;
      font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
    }
    * {
      box-sizing: border-box;
    }
    h1,
    h2,
    p {
      margin-top: 0;
    }
    h2 {
      color: #fff2d7;
      font-size: 1.05rem;
      line-height: 1.4;
    }
    p {
      color: #c5d4e5;
      line-height: 1.6;
    }
    a {
      color: #8cdbff;
      text-underline-offset: 0.2em;
    }
    button,
    select,
    .hero-actions a,
    .support-cta {
      font: inherit;
      border: 1px solid #587895;
      border-radius: 0.5rem;
      padding: 0.65rem 0.9rem;
      min-height: 44px;
    }
    button,
    select {
      color: #e9f2ff;
      background: #09223c;
    }
    button {
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    :is(a, button, select, [tabindex]):focus-visible {
      outline: 3px solid #ffdf76;
      outline-offset: 4px;
    }
    .hero-panel {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      min-height: 24rem;
      display: flex;
      align-items: center;
      border-bottom: 1px solid #294862;
    }
    .hero-city,
    .hero-dragon {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: -2;
    }
    .hero-city {
      opacity: 0.4;
    }
    .hero-dragon {
      left: auto;
      width: 60%;
      object-position: center;
      opacity: 0.6;
    }
    .hero-panel::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      background: linear-gradient(
        90deg,
        #020914 5%,
        rgba(2, 9, 20, 0.7) 55%,
        transparent
      );
    }
    .hero-copy {
      padding: 3rem clamp(1rem, 5vw, 5rem);
      max-width: 58rem;
    }
    h1 {
      font-size: clamp(2rem, 4.5vw, 3.6rem);
      line-height: 1.12;
      margin-bottom: 1rem;
    }
    h1 strong {
      display: block;
      color: #ffd879;
    }
    .hero-copy p {
      max-width: 42rem;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
    }
    .hero-actions a,
    .support-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
    }
    .hero-actions button:first-child,
    .support-cta {
      background: #f6bf48;
      border-color: #f6bf48;
      color: #152034;
      font-weight: 700;
    }
    .secondary {
      background: #09223ce8;
      color: #e9f2ff;
    }
    .page-content {
      max-width: 1440px;
      margin: auto;
      padding: 1.25rem clamp(1rem, 4vw, 4rem) 0;
    }
    .panel {
      background: #06172a;
      border: 1px solid #294862;
      border-radius: 0.75rem;
      padding: 1.3rem;
      min-width: 0;
    }
    .status-panel {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 1rem;
    }
    .status-panel p {
      margin: 0;
    }
    .error {
      color: #ffb9ac;
    }
    .sync-strip {
      grid-column: 1/-1;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1rem;
      margin: 0;
    }
    dt {
      color: #aebfd3;
      font-size: 0.8rem;
    }
    dd {
      margin: 0.35rem 0 0;
      font-size: 0.9rem;
      overflow-wrap: anywhere;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    .kpi-card h2 {
      font-size: 0.95rem;
    }
    .kpi-card strong {
      display: block;
      font-size: clamp(1.3rem, 2.2vw, 2rem);
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .kpi-card p {
      font-size: 0.8rem;
      margin: 0.5rem 0 0;
    }
    .kpi-card.net strong {
      color: #77e6ac;
    }
    .fee-quality {
      border-top: 1px solid #294862;
      padding-top: 0.5rem;
    }
    .fee-quality.provisional {
      color: #ffdf76;
    }
    .campaign-card {
      margin: 1rem 0;
    }
    .campaign-card header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .campaign-card h2 {
      margin: 0;
    }
    .campaign-card h2 span {
      display: block;
      color: #c5d4e5;
      font-size: 0.8rem;
      font-weight: 400;
    }
    .campaign-card header strong {
      color: #ffd879;
      font-size: 1.5rem;
    }
    .campaign-track {
      height: 0.8rem;
      background: #26374b;
      border-radius: 1rem;
      overflow: hidden;
      margin: 1rem 0;
    }
    .campaign-track span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #f2a925, #ffdf76);
    }
    .campaign-card p {
      margin-bottom: 0.35rem;
    }
    .fine-print {
      font-size: 0.8rem;
    }
    .dashboard-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
      gap: 1rem;
    }
    .support-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-top: 1rem;
    }
    .support-strip p {
      margin-bottom: 0;
    }
    .support-cta {
      flex-shrink: 0;
    }
    .page-footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 2rem 0;
    }
    .page-footer nav {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .page-footer small {
      color: #aebfd3;
    }
    @media (max-width: 900px) {
      .kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .dashboard-grid {
        grid-template-columns: 1fr;
      }
      .sync-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 540px) {
      .hero-copy {
        padding: 2rem 1rem;
      }
      .hero-dragon {
        width: 100%;
        opacity: 0.3;
      }
      .status-panel {
        grid-template-columns: 1fr;
      }
      .status-panel button {
        justify-self: start;
      }
      .panel {
        padding: 1rem;
      }
      .kpi-grid {
        gap: 0.6rem;
      }
      .kpi-card strong {
        font-size: 1.25rem;
      }
      .support-strip {
        align-items: start;
        flex-direction: column;
      }
    }
  `
})
export class FundingTransparencyPageComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly i18n = inject(FundingI18nService);
  readonly config =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;
  readonly transparency = new FundingTransparencyController({
    transparency: inject(FundTransparencyService),
    config: this.config,
    i18n: this.i18n,
    isBrowser: () => isPlatformBrowser(this.platformId),
    now: () => new Date(),
    navigate: (queryParams) =>
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams,
        fragment: 'public-registry'
      }),
    publicLink: (queryParams) =>
      this.router.serializeUrl(
        this.router.createUrlTree(
          [this.i18n.localizedPath('/fonds-des-batisseurs/transparence')],
          { queryParams }
        )
      )
  });
  readonly currentYear = new Date().getFullYear();
  readonly homePath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs')
  );
  readonly aboutPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/a-propos')
  );
  readonly ecosystemPath = computed(() =>
    this.i18n.localizedPath('/ecosystem')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly policyPath = computed(() =>
    this.i18n.localizedPath('/politique-utilisation-remboursement')
  );
  readonly formatPublicMoney = (value: number, currency: string): string =>
    this.formatMoney(value, currency, 'code');
  readonly formatPublicDate = (value: string | null | undefined): string =>
    this.formatDate(value);

  constructor() {
    this.destroyRef.onDestroy(() => this.transparency.dispose());
    inject(FundingSeoService).bind(
      {
        titleKey: 'funding.seo.transparency.title',
        descriptionKey: 'funding.seo.transparency.description',
        path: '/fonds-des-batisseurs/transparence',
        imagePath:
          '/assets/fonds-des-batisseurs-feuille-erable-lumineuse-1920.webp'
      },
      inject(Injector)
    );
  }

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.transparency.applyView(params.get('period'), params.get('type'));
      });
    this.transparency.start();
  }

  formatMoney(
    value: number | null,
    currency: string = this.config.currency,
    currencyDisplay: 'symbol' | 'code' = 'symbol'
  ): string {
    if (value === null) return '—';
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency,
      currencyDisplay,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  formatDate(value: string | null | undefined): string {
    if (!value || !Number.isFinite(Date.parse(value))) return '—';
    return (
      new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
      }).format(new Date(value)) + ' UTC'
    );
  }
}
