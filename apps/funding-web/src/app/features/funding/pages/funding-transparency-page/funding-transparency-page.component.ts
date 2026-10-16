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
  styleUrl: './funding-transparency-page.component.css'
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
        fragment: 'public-registry',
        // Keep the controls still while changing the shareable registry view.
        scroll: 'manual'
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
