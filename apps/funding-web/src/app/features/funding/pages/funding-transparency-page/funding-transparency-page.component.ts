import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { FundTransparencyPublicResponse } from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FUNDING_PROJECT_CONFIG } from '../../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../../config/openg7-funding.config.js';
import {
  currentFundingMonth,
  monthlyContributions
} from '../../models/funding-home.utils.js';
import {
  isTransparencyReport,
  parseTransparencyView,
  type TransparencyRegistryFilter,
  transparencyCsv,
  transparencyExport
} from '../../models/funding-transparency.utils.js';
import { FundTransparencyService } from '../../services/fund-transparency.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

@Component({
  selector: 'openg7-funding-transparency-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslatePipe,
    FundingHeaderComponent
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
            <button type="button" (click)="scrollToRegistry()">
              {{ 'funding.transparencyPage.hero.viewRegistry' | translate }}
            </button>
            <button
              type="button"
              class="secondary"
              data-og7="transparency-json"
              [disabled]="!canExport()"
              (click)="downloadReport()"
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
            @if (loading()) {
              <p>{{ 'funding.transparencyPage.state.loading' | translate }}</p>
            } @else if (error()) {
              <p class="error">
                {{
                  (hasSnapshot()
                    ? 'funding.transparencyPage.state.stale'
                    : 'funding.transparencyPage.state.error'
                  ) | translate
                }}
              </p>
            } @else if (!hasSnapshot()) {
              <p>{{ 'funding.transparencyPage.state.noSource' | translate }}</p>
            } @else {
              <p>{{ 'funding.transparencyPage.state.ready' | translate }}</p>
            }
          </div>
          <button
            type="button"
            data-og7="transparency-refresh"
            [disabled]="loading()"
            (click)="refresh()"
          >
            {{
              (error()
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
                {{ hasSnapshot() ? formatDate(data()?.last_updated_at) : '—' }}
              </dd>
            </div>
            <div>
              <dt>{{ 'funding.transparencyPage.sync.checked' | translate }}</dt>
              <dd data-og7="checked-date">{{ formatDate(checkedAt()) }}</dd>
            </div>
            <div>
              <dt>{{ 'funding.home.purpose.source' | translate }}</dt>
              <dd>{{ sourceLabel() }}</dd>
            </div>
            <div>
              <dt>{{ 'funding.home.purpose.currency' | translate }}</dt>
              <dd>{{ hasSnapshot() ? data()?.currency : '—' }}</dd>
            </div>
          </dl>
        </section>

        <section
          class="kpi-grid"
          data-og7="transparency-totals"
          [attr.aria-busy]="loading()"
          aria-label="{{
            'funding.transparencyPage.kpis.ariaLabel' | translate
          }}"
        >
          @for (card of kpiCards(); track card.label) {
            <article class="kpi-card panel" [class.net]="card.net">
              <h2>{{ card.label | translate }}</h2>
              <strong>{{ formatMoney(card.value, data()?.currency) }}</strong>
              <p>{{ card.detail | translate }}</p>
              @if (card.net && hasSnapshot()) {
                <p
                  class="fee-quality"
                  [class.provisional]="(data()?.pending_fee_count ?? 0) > 0"
                  data-og7="fee-quality"
                >
                  {{
                    feeQualityKey()
                      | translate: { count: data()?.pending_fee_count }
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
              <span>{{ currentMonth() }} (UTC)</span>
            </h2>
            <strong>{{
              monthlyProgress() === null ? '—' : monthlyProgress() + '%'
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
            [attr.aria-valuenow]="monthlyProgress()"
          >
            <span [style.width.%]="monthlyProgress() ?? 0"></span>
          </div>
          <p>
            <span data-og7="monthly-received">{{
              formatMoney(currentMonthReceived())
            }}</span>
            /
            {{ formatMoney(config.monthlyGoal) }}
            · {{ 'funding.transparencyPage.campaign.goal' | translate }}
          </p>
          @if (remainingForGoal() !== null) {
            <p>
              {{ formatMoney(remainingForGoal()) }}
              {{ 'funding.transparencyPage.campaign.remaining' | translate }}
            </p>
          }
          @if (hasSnapshot() && currentMonthReceived() === null) {
            <p role="status">
              {{ 'funding.transparencyPage.campaign.unavailable' | translate }}
            </p>
          }
          <p class="fine-print">
            {{ 'funding.transparencyPage.campaign.scope' | translate }}
          </p>
        </section>

        <section class="dashboard-grid">
          <article
            id="public-registry"
            class="panel registry-panel"
            tabindex="-1"
            aria-labelledby="registry-title"
          >
            <h2 id="registry-title">
              {{ 'funding.transparencyPage.registry.title' | translate }}
            </h2>
            <p>{{ 'funding.transparencyPage.registry.scope' | translate }}</p>
            <label for="registry-period">{{
              'funding.transparencyPage.registry.period' | translate
            }}</label>
            <select
              id="registry-period"
              data-og7="transparency-period"
              [ngModel]="period()"
              [disabled]="!hasSnapshot()"
              (ngModelChange)="selectPeriod($event)"
            >
              <option value="all">
                {{ 'funding.transparencyPage.registry.allPeriods' | translate }}
              </option>
              @for (month of availableMonths(); track month) {
                <option [value]="month">{{ month }}</option>
              }
              @if (periodUnavailable()) {
                <option [value]="period()">{{ period() }}</option>
              }
            </select>
            <div
              class="registry-filters"
              role="group"
              aria-label="{{
                'funding.transparencyPage.registry.filterLabel' | translate
              }}"
            >
              @for (filter of registryFilters; track filter) {
                <button
                  type="button"
                  [attr.aria-pressed]="registryFilter() === filter"
                  (click)="selectFilter(filter)"
                >
                  {{
                    'funding.transparencyPage.registry.filters.' + filter
                      | translate
                  }}
                </button>
              }
            </div>
            @if (periodUnavailable() && hasSnapshot() && !loading()) {
              <p role="status">
                {{
                  'funding.transparencyPage.registry.unavailablePeriod'
                    | translate
                }}
              </p>
            }
            <div class="table-wrap">
              <table>
                <caption>
                  {{
                    'funding.transparencyPage.registry.caption' | translate
                  }}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      {{
                        'funding.transparencyPage.registry.headers.period'
                          | translate
                      }}
                    </th>
                    <th scope="col">
                      {{
                        'funding.transparencyPage.registry.headers.type'
                          | translate
                      }}
                    </th>
                    <th scope="col">
                      {{
                        'funding.transparencyPage.registry.headers.amount'
                          | translate
                      }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of registryRows(); track row.id) {
                    <tr>
                      <td>{{ row.month }}</td>
                      <td>
                        {{
                          'funding.transparencyPage.registry.filters.' +
                            row.type | translate
                        }}
                      </td>
                      <td>
                        {{ formatMoney(row.amount, row.currency, 'code') }}
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="3">
                        {{
                          (hasSnapshot() && !periodUnavailable()
                            ? 'funding.transparencyPage.registry.empty'
                            : 'funding.transparencyPage.state.unavailable'
                          ) | translate
                        }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="fine-print">
              {{ 'funding.transparencyPage.registry.feesNote' | translate }}
            </p>
          </article>

          <article
            class="panel expenses-panel"
            data-og7="published-allocations"
          >
            <h2>{{ 'funding.transparencyPage.expenses.title' | translate }}</h2>
            <p>{{ 'funding.transparencyPage.expenses.info' | translate }}</p>
            @for (allocation of publicAllocations(); track $index) {
              <div class="allocation">
                <h3>{{ allocation.project_name }}</h3>
                <strong>{{
                  formatMoney(
                    allocation.amount_allocated,
                    allocation.currency,
                    'code'
                  )
                }}</strong>
                @if (allocation.public_description) {
                  <p>{{ allocation.public_description }}</p>
                }
                @if (allocation.expected_outcome) {
                  <p>{{ allocation.expected_outcome }}</p>
                }
                <p class="allocation-progress">
                  {{
                    'funding.transparencyPage.expenses.progress.' +
                      (allocation.progress_status === 'in_progress'
                        ? 'inProgress'
                        : allocation.progress_status) | translate
                  }}
                </p>
                @if (allocation.published_at) {
                  <p>
                    {{
                      'funding.transparencyPage.expenses.published' | translate
                    }}
                    {{ formatDate(allocation.published_at) }}
                  </p>
                }
                @if (allocation.proof_url) {
                  <a
                    [href]="allocation.proof_url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{
                      allocation.proof_source ||
                        ('funding.transparencyPage.expenses.proof' | translate)
                    }}
                    @if (allocation.proof_published_at) {
                      <span
                        >({{ formatDate(allocation.proof_published_at) }})</span
                      >
                    }
                  </a>
                }
              </div>
            } @empty {
              <p>
                {{
                  (hasSnapshot()
                    ? 'funding.transparencyPage.expenses.empty'
                    : 'funding.transparencyPage.state.unavailable'
                  ) | translate
                }}
              </p>
            }
            <a [routerLink]="aboutPath()" fragment="about-mission-title">{{
              'funding.transparencyPage.allocation.learnMore' | translate
            }}</a>
          </article>

          <article class="panel method-panel">
            <h2>{{ 'funding.transparencyPage.method.title' | translate }}</h2>
            <p class="formula">
              {{ 'funding.transparencyPage.method.formula' | translate }}
            </p>
            <p>{{ 'funding.transparencyPage.method.copy' | translate }}</p>
            <p>{{ 'funding.transparencyPage.method.payouts' | translate }}</p>
            <p>{{ 'funding.transparencyPage.method.limits' | translate }}</p>
          </article>

          <article class="panel reports-panel">
            <h2>{{ 'funding.transparencyPage.reports.title' | translate }}</h2>
            <p>
              {{ 'funding.transparencyPage.reports.scope' | translate }}
              <strong>{{
                period() === 'all'
                  ? ('funding.transparencyPage.registry.allPeriods' | translate)
                  : period()
              }}</strong>
            </p>
            <p>{{ 'funding.transparencyPage.reports.contents' | translate }}</p>
            <div class="report-actions">
              <button
                type="button"
                data-og7="transparency-csv"
                [disabled]="!canExport()"
                (click)="downloadCsv()"
              >
                {{ 'funding.transparencyPage.reports.exportCsv' | translate }}
              </button>
              <button
                type="button"
                [disabled]="!canExport()"
                (click)="downloadReport()"
              >
                {{
                  'funding.transparencyPage.reports.downloadMonthly' | translate
                }}
              </button>
              <button type="button" (click)="copyTransparencyLink()">
                {{ 'funding.transparencyPage.reports.copyLink' | translate }}
              </button>
            </div>
            <p role="status">
              {{
                copyState()
                  ? ('funding.transparencyPage.reports.' + copyState()
                    | translate)
                  : ''
              }}
            </p>
          </article>

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
    h3,
    p {
      margin-top: 0;
    }
    h2 {
      color: #fff2d7;
      font-size: 1.05rem;
      line-height: 1.4;
    }
    h3 {
      color: #fff2d7;
      font-size: 1rem;
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
    .hero-actions,
    .report-actions {
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
    .registry-panel label {
      display: block;
      font-size: 0.9rem;
      margin-bottom: 0.4rem;
    }
    .registry-panel select {
      max-width: 100%;
    }
    .registry-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 1rem 0;
    }
    [aria-pressed='true'] {
      background: #17639b;
      border-color: #8cdbff;
    }
    .table-wrap {
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    caption {
      text-align: left;
      color: #aebfd3;
      font-size: 0.8rem;
      margin-bottom: 0.8rem;
    }
    th,
    td {
      padding: 0.75rem 0.4rem;
      border-bottom: 1px solid #294862;
      text-align: left;
    }
    th:last-child,
    td:last-child {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    td:last-child {
      white-space: nowrap;
    }
    .allocation {
      border-top: 1px solid #294862;
      padding: 1rem 0;
    }
    .allocation h3 {
      margin-bottom: 0.5rem;
    }
    .allocation p {
      font-size: 0.9rem;
      margin: 0.5rem 0;
    }
    .allocation-progress {
      color: #ffd879;
    }
    .formula {
      color: #ffd879;
      font-weight: 700;
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
  private readonly transparencyService = inject(FundTransparencyService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly i18n = inject(FundingI18nService);
  readonly config =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;
  private controller: AbortController | null = null;

  constructor() {
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

  readonly data = signal<FundTransparencyPublicResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly checkedAt = signal<string | null>(null);
  readonly currentMonth = signal('');
  readonly registryFilter = signal<TransparencyRegistryFilter>('all');
  readonly registryFilters: readonly TransparencyRegistryFilter[] = [
    'all',
    'contributions',
    'fees',
    'refunds'
  ];
  readonly period = signal('all');
  readonly copyState = signal<'' | 'copied' | 'copyFailed'>('');
  readonly currentYear = new Date().getFullYear();
  readonly snapshotMonth = signal('');
  readonly hasSnapshot = computed(
    () => this.data() !== null && this.data()?.data_source !== 'empty'
  );
  readonly canExport = computed(
    () =>
      this.hasSnapshot() &&
      !this.loading() &&
      !this.error() &&
      !this.periodUnavailable()
  );
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
  readonly sourceLabel = computed(() =>
    !this.hasSnapshot()
      ? '—'
      : this.i18n.t(
          this.data()?.data_source === 'database'
            ? 'funding.transparencyPage.sync.database'
            : 'funding.transparencyPage.sync.stripe'
        )
  );
  readonly feeQualityKey = computed(() => {
    const count = this.data()?.pending_fee_count;
    return (
      'funding.transparencyPage.kpis.' +
      (count == null
        ? 'feesUnknown'
        : count > 0
          ? 'feesPending'
          : 'feesComplete')
    );
  });
  readonly kpiCards = computed(() => {
    const report = this.hasSnapshot() ? this.data() : null;
    return [
      {
        label: 'funding.transparency.confirmed',
        value: report?.total_received ?? null,
        detail: 'funding.transparencyPage.kpis.cumulative',
        net: false
      },
      {
        label: 'funding.home.purpose.paymentFees',
        value: report?.total_fees ?? null,
        detail: 'funding.transparencyPage.kpis.totalFees',
        net: false
      },
      {
        label: 'funding.transparencyPage.kpis.refunds',
        value: report?.total_refunded ?? null,
        detail: 'funding.transparencyPage.kpis.totalRefunded',
        net: false
      },
      {
        label: 'funding.transparencyPage.kpis.netBeforeExpenses',
        value: report?.current_available_estimate ?? null,
        detail: 'funding.transparencyPage.kpis.availableForProjects',
        net: true
      }
    ];
  });
  readonly currentMonthReceived = computed(() => {
    const report = this.data();
    if (
      !this.hasSnapshot() ||
      !report ||
      this.snapshotMonth() !== this.currentMonth() ||
      report.currency !== this.config.currency
    )
      return null;
    return monthlyContributions(
      report.monthly_summary,
      this.currentMonth(),
      this.config.currency
    );
  });
  readonly monthlyProgress = computed(() => {
    const received = this.currentMonthReceived();
    return received === null
      ? null
      : this.config.monthlyGoal <= 0
        ? 0
        : Math.min(
            100,
            Math.max(0, Math.round((received / this.config.monthlyGoal) * 100))
          );
  });
  readonly remainingForGoal = computed(() => {
    const received = this.currentMonthReceived();
    return received === null
      ? null
      : Math.max(0, this.config.monthlyGoal - received);
  });
  readonly availableMonths = computed(() =>
    [...new Set(this.data()?.monthly_summary.map((row) => row.month) ?? [])]
      .sort()
      .reverse()
  );
  readonly periodUnavailable = computed(
    () =>
      this.period() !== 'all' && !this.availableMonths().includes(this.period())
  );
  readonly registryRows = computed(() => {
    if (!this.hasSnapshot()) return [];
    return (this.data()?.monthly_summary ?? [])
      .filter((row) => this.period() === 'all' || row.month === this.period())
      .flatMap((row) =>
        [
          { type: 'contributions', amount: row.total_received },
          { type: 'fees', amount: row.total_fees },
          { type: 'refunds', amount: row.total_refunded }
        ]
          .filter(
            (entry) =>
              entry.amount !== 0 &&
              (this.registryFilter() === 'all' ||
                this.registryFilter() === entry.type)
          )
          .map((entry) => ({
            ...entry,
            id: `${row.month}-${entry.type}`,
            month: row.month,
            currency: row.currency
          }))
      );
  });
  readonly publicAllocations = computed(() =>
    this.hasSnapshot() ? (this.data()?.latest_public_allocations ?? []) : []
  );

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const view = parseTransparencyView(
          params.get('period'),
          params.get('type')
        );
        this.period.set(view.period);
        this.registryFilter.set(view.filter);
        this.copyState.set('');
      });
    if (!isPlatformBrowser(this.platformId)) return;
    void this.refresh();
    const interval = setInterval(() => {
      if (!document.hidden) void this.refresh();
    }, 60_000);
    this.destroyRef.onDestroy(() => {
      clearInterval(interval);
      this.controller?.abort();
    });
  }

  async refresh(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    this.loading.set(true);
    const startedAt = new Date();
    this.currentMonth.set(currentFundingMonth(startedAt));
    try {
      const report = await this.transparencyService.getPublicTransparency(
        controller.signal
      );
      if (this.destroyRef.destroyed) return;
      if (!isTransparencyReport(report))
        throw new Error('Invalid public transparency response');
      this.data.set(report);
      this.snapshotMonth.set(
        currentFundingMonth(
          new Date(report.generated_at ?? startedAt.toISOString())
        )
      );
      this.currentMonth.set(currentFundingMonth(new Date()));
      this.checkedAt.set(new Date().toISOString());
      this.error.set(false);
    } catch {
      if (!this.destroyRef.destroyed) this.error.set(true);
    } finally {
      clearTimeout(timeout);
      this.controller = null;
      if (!this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  formatMoney(
    value: number | null,
    currency = this.config.currency,
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

  selectPeriod(value: string): void {
    if (value === 'all' || this.availableMonths().includes(value)) {
      this.period.set(value);
      void this.updateViewUrl();
    }
  }

  selectFilter(filter: TransparencyRegistryFilter): void {
    this.registryFilter.set(filter);
    void this.updateViewUrl();
  }

  private viewQueryParams() {
    return {
      period: this.period() === 'all' ? null : this.period(),
      type: this.registryFilter() === 'all' ? null : this.registryFilter()
    };
  }

  private updateViewUrl(): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.viewQueryParams(),
      fragment: 'public-registry'
    });
  }

  scrollToRegistry(): void {
    const element = document.getElementById('public-registry');
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  downloadReport(): void {
    const report = this.data();
    if (!this.canExport() || !report) return;
    this.downloadBlob(
      new Blob(
        [
          JSON.stringify(
            transparencyExport(report, this.period(), new Date().toISOString()),
            null,
            2
          )
        ],
        { type: 'application/json' }
      ),
      `openg7-transparence-fonds-batisseurs${this.period() === 'all' ? '' : '-' + this.period()}.json`
    );
  }

  downloadCsv(): void {
    const report = this.data();
    if (!this.canExport() || !report) return;
    this.downloadBlob(
      new Blob(
        [transparencyCsv(report, this.period(), new Date().toISOString())],
        { type: 'text/csv;charset=utf-8' }
      ),
      `openg7-registre-public${this.period() === 'all' ? '' : '-' + this.period()}.csv`
    );
  }

  async copyTransparencyLink(): Promise<void> {
    try {
      const tree = this.router.createUrlTree(
        [this.i18n.localizedPath('/fonds-des-batisseurs/transparence')],
        { queryParams: this.viewQueryParams() }
      );
      await navigator.clipboard.writeText(
        new URL(this.router.serializeUrl(tree), window.location.origin).href
      );
      if (!this.destroyRef.destroyed) this.copyState.set('copied');
    } catch {
      if (!this.destroyRef.destroyed) this.copyState.set('copyFailed');
    }
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
