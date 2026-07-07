import {
  CommonModule,
  CurrencyPipe,
  DatePipe,
  isPlatformBrowser
} from '@angular/common';
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
  PublicMonthlySummary
} from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';
import { FundingService } from '../../services/funding.service.js';
import { FundTransparencyService } from '../../services/fund-transparency.service.js';

interface KpiCard {
  readonly labelKey: string;
  readonly value: number;
  readonly detailKey: string;
  readonly detailParams?: Record<string, number | string>;
  readonly tone: 'blue' | 'red' | 'green' | 'gold';
  readonly kind: 'currency' | 'count';
}

interface PlatformMiniCard {
  readonly id: number;
  readonly name: string;
  readonly asset: string;
}

interface CalculationRow {
  readonly labelKey: string;
  readonly sign: '+' | '-' | '=';
}

interface SetupFact {
  readonly labelKey: string;
  readonly value?: string;
  readonly valueKey?: string;
}

interface FlowStep {
  readonly titleKey: string;
  readonly descriptionKey: string;
}

interface AllocationPlanItem {
  readonly labelKey: string;
  readonly share: number;
  readonly color: string;
}

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
  selector: 'openg7-funding-transparency-page',
  standalone: true,
  imports: [
    CommonModule,
    CurrencyPipe,
    DatePipe,
    RouterLink,
    TranslatePipe,
    FundingHeaderComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="transparency-dashboard">
      <openg7-funding-header></openg7-funding-header>

      <section class="hero-panel" aria-labelledby="transparency-title">
        <img
          class="hero-city"
          src="assets/fonds-des-batisseurs-feuille-erable-lumineuse.png"
          [alt]="'funding.transparencyPage.hero.cityAlt' | translate"
        />
        <img
          class="hero-dragon"
          src="assets/fonds-des-batisseurs-dragon-coffre-fort.png"
          [alt]="'funding.transparencyPage.hero.dragonAlt' | translate"
        />
        <div class="hero-overlay" aria-hidden="true"></div>

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
            <button type="button" class="secondary" (click)="downloadReport()">
              {{ 'funding.transparencyPage.hero.downloadReport' | translate }}
            </button>
            <button type="button" class="secondary" (click)="scrollToSupport()">
              {{ 'funding.nav.supportCta' | translate }}
            </button>
          </div>
        </div>

        <dl class="sync-strip">
          <div *ngFor="let fact of setupFacts()">
            <dt>{{ fact.labelKey | translate }}</dt>
            <dd>
              {{ fact.valueKey ? (fact.valueKey | translate) : fact.value }}
            </dd>
          </div>
        </dl>
      </section>

      <section
        class="kpi-grid"
        [attr.aria-label]="
          'funding.transparencyPage.kpis.ariaLabel' | translate
        "
      >
        <article
          class="kpi-card"
          *ngFor="let card of kpiCards()"
          [class]="card.tone"
        >
          <span class="kpi-icon" aria-hidden="true">{{
            kpiIcon(card.tone)
          }}</span>
          <div>
            <h2>{{ card.labelKey | translate }}</h2>
            <strong *ngIf="card.kind === 'currency'">
              {{
                card.value | currency: report().currency : 'symbol' : '1.2-2'
              }}
            </strong>
            <strong *ngIf="card.kind === 'count'">{{ card.value }}</strong>
            <p>{{ card.detailKey | translate: card.detailParams }}</p>
          </div>
        </article>
      </section>

      <section class="campaign-card">
        <header>
          <span>{{
            'funding.transparencyPage.campaign.progress' | translate
          }}</span>
          <strong>{{ monthlyProgress() }}%</strong>
        </header>
        <div class="campaign-track" aria-hidden="true">
          <span [style.width.%]="monthlyProgress()"></span>
        </div>
        <p>
          {{
            remainingForGoal()
              | currency: report().currency : 'symbol' : '1.2-2'
          }}
          {{ 'funding.transparencyPage.campaign.remaining' | translate }}
        </p>
      </section>

      <section class="dashboard-grid">
        <article class="panel flow-panel">
          <h2>{{ 'funding.transparencyPage.flow.title' | translate }}</h2>
          <ol>
            <li *ngFor="let item of flowSteps; let index = index">
              <span>{{ index + 1 }}</span>
              <div>
                <strong>{{ item.titleKey | translate }}</strong>
                <p>{{ item.descriptionKey | translate }}</p>
              </div>
            </li>
          </ol>
          <dl>
            <div>
              <dt>
                {{
                  'funding.transparencyPage.flow.totals.received' | translate
                }}
              </dt>
              <dd>
                {{
                  report().total_received
                    | currency: report().currency : 'symbol' : '1.2-2'
                }}
              </dd>
            </div>
            <div>
              <dt>
                {{ 'funding.transparencyPage.flow.totals.fees' | translate }}
              </dt>
              <dd>
                {{
                  report().total_fees
                    | currency: report().currency : 'symbol' : '1.2-2'
                }}
              </dd>
            </div>
            <div>
              <dt>
                {{ 'funding.transparencyPage.flow.totals.net' | translate }}
              </dt>
              <dd>
                {{
                  report().current_available_estimate
                    | currency: report().currency : 'symbol' : '1.2-2'
                }}
              </dd>
            </div>
          </dl>
        </article>

        <article id="public-registry" class="panel registry-panel">
          <header>
            <h2>{{ 'funding.transparencyPage.registry.title' | translate }}</h2>
            <div>
              <button
                type="button"
                [class.active]="registryFilter() === 'all'"
                (click)="registryFilter.set('all')"
              >
                {{
                  'funding.transparencyPage.registry.filters.all' | translate
                }}
              </button>
              <button
                type="button"
                [class.active]="registryFilter() === 'contributions'"
                (click)="registryFilter.set('contributions')"
              >
                {{
                  'funding.transparencyPage.registry.filters.contributions'
                    | translate
                }}
              </button>
              <button
                type="button"
                [class.active]="registryFilter() === 'fees'"
                (click)="registryFilter.set('fees')"
              >
                {{
                  'funding.transparencyPage.registry.filters.fees' | translate
                }}
              </button>
            </div>
          </header>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    {{
                      'funding.transparencyPage.registry.headers.period'
                        | translate
                    }}
                  </th>
                  <th>
                    {{
                      'funding.transparencyPage.registry.headers.type'
                        | translate
                    }}
                  </th>
                  <th>
                    {{
                      'funding.transparencyPage.registry.headers.reference'
                        | translate
                    }}
                  </th>
                  <th>
                    {{
                      'funding.transparencyPage.registry.headers.description'
                        | translate
                    }}
                  </th>
                  <th>
                    {{
                      'funding.transparencyPage.registry.headers.amount'
                        | translate
                    }}
                  </th>
                  <th>
                    {{
                      'funding.transparencyPage.registry.headers.status'
                        | translate
                    }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of visibleRegistryRows()">
                  <td>{{ row.month }}</td>
                  <td [class.positive]="row.total_received > 0">
                    {{
                      'funding.transparencyPage.registry.types.contribution'
                        | translate
                    }}
                  </td>
                  <td>OG7-{{ row.month }}</td>
                  <td>
                    {{
                      'funding.transparencyPage.registry.monthlyStripe'
                        | translate
                    }}
                  </td>
                  <td class="positive">
                    {{
                      row.total_received
                        | currency: row.currency : 'symbol' : '1.2-2'
                    }}
                  </td>
                  <td>
                    <span class="state-pill">{{
                      'funding.transparencyPage.registry.status.confirmed'
                        | translate
                    }}</span>
                  </td>
                </tr>
                <tr *ngFor="let row of visibleFeeRows()">
                  <td>{{ row.month }}</td>
                  <td class="negative">
                    {{
                      'funding.transparencyPage.registry.types.fee' | translate
                    }}
                  </td>
                  <td>OG7-F-{{ row.month }}</td>
                  <td>
                    {{
                      'funding.transparencyPage.registry.stripeFees' | translate
                    }}
                  </td>
                  <td class="negative">
                    {{
                      row.total_fees
                        | currency: row.currency : 'symbol' : '1.2-2'
                    }}
                  </td>
                  <td>
                    <span class="state-pill accounting">{{
                      'funding.transparencyPage.registry.status.accounted'
                        | translate
                    }}</span>
                  </td>
                </tr>
                <tr
                  *ngIf="
                    visibleRegistryRows().length === 0 &&
                    visibleFeeRows().length === 0
                  "
                >
                  <td colspan="6" class="empty-row">
                    {{ 'funding.transparencyPage.registry.empty' | translate }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <button type="button" class="text-link" (click)="downloadCsv()">
            {{ 'funding.transparencyPage.registry.exportCsv' | translate }}
          </button>
        </article>

        <article class="panel allocation-panel">
          <h2>{{ 'funding.transparencyPage.allocation.title' | translate }}</h2>
          <div class="donut" aria-hidden="true"></div>
          <ul>
            <li *ngFor="let allocation of allocationPlan">
              <span [style.background]="allocation.color"></span>
              <strong>{{ allocation.share }}%</strong>
              <p>{{ allocation.labelKey | translate }}</p>
            </li>
          </ul>
          <p class="fine-print">
            {{ 'funding.transparencyPage.allocation.finePrint' | translate }}
          </p>
        </article>

        <article class="panel expenses-panel">
          <h2>{{ 'funding.transparencyPage.expenses.title' | translate }}</h2>
          <div class="mini-table">
            <div *ngFor="let allocation of publicAllocations()">
              <span>{{ allocation.published_at | date: 'MMM y' }}</span>
              <strong>{{ allocation.project_name }}</strong>
              <em>{{
                allocation.amount_allocated
                  | currency: allocation.currency : 'symbol' : '1.2-2'
              }}</em>
            </div>
            <p *ngIf="publicAllocations().length === 0">
              {{ 'funding.transparencyPage.expenses.empty' | translate }}
            </p>
          </div>
          <p class="info-box">
            {{ 'funding.transparencyPage.expenses.info' | translate }}
          </p>
        </article>

        <article class="panel platforms-panel">
          <h2>{{ 'funding.transparencyPage.platforms.title' | translate }}</h2>
          <div class="platform-grid">
            <div *ngFor="let platform of platforms">
              <img [src]="platform.asset" [alt]="platform.name" />
              <span>{{ platform.id }}</span>
              <p>{{ platform.name }}</p>
            </div>
          </div>
          <p>{{ 'funding.transparencyPage.platforms.copy' | translate }}</p>
        </article>

        <article class="panel method-panel">
          <h2>{{ 'funding.transparencyPage.method.title' | translate }}</h2>
          <dl>
            <div *ngFor="let row of calculationRows">
              <dt>{{ row.labelKey | translate }}</dt>
              <dd>{{ row.sign }}</dd>
            </div>
          </dl>
          <strong>{{
            'funding.transparencyPage.method.result' | translate
          }}</strong>
          <p>{{ 'funding.transparencyPage.method.copy' | translate }}</p>
        </article>

        <article class="panel privacy-panel">
          <h2>{{ 'funding.transparencyPage.privacy.title' | translate }}</h2>
          <div class="privacy-columns">
            <ul>
              <li *ngFor="let item of publicDataChecklist">
                {{ item | translate }}
              </li>
            </ul>
            <ul>
              <li *ngFor="let item of protectedDataChecklist">
                {{ item | translate }}
              </li>
            </ul>
          </div>
          <p>
            {{ 'funding.transparencyPage.privacy.copy' | translate }}
          </p>
        </article>

        <article class="panel reports-panel">
          <h2>{{ 'funding.transparencyPage.reports.title' | translate }}</h2>
          <button type="button" (click)="downloadCsv()">
            {{ 'funding.transparencyPage.reports.exportCsv' | translate }}
          </button>
          <button type="button" (click)="downloadReport()">
            {{ 'funding.transparencyPage.reports.downloadMonthly' | translate }}
          </button>
          <button type="button" (click)="copyTransparencyLink()">
            {{ 'funding.transparencyPage.reports.copyLink' | translate }}
          </button>
        </article>

        <article class="panel about-panel">
          <h2>{{ 'funding.transparencyPage.about.title' | translate }}</h2>
          <p>{{ 'funding.transparencyPage.about.copy' | translate }}</p>
          <ul>
            <li>
              {{ 'funding.transparencyPage.about.paymentSource' | translate }}
            </li>
            <li>
              {{
                'funding.transparencyPage.about.primaryCurrency' | translate
              }}: {{ report().currency }}
            </li>
            <li>
              {{ 'funding.transparencyPage.about.syncFrequency' | translate }}
            </li>
            <li>Contact: info&#64;openg7.org</li>
          </ul>
        </article>
      </section>

      <section id="support" class="support-strip">
        <img
          src="assets/openg7-funding-platform-dragon-coffre.png"
          [alt]="'funding.transparencyPage.support.imageAlt' | translate"
        />
        <div>
          <h2>{{ 'funding.transparencyPage.support.title' | translate }}</h2>
          <p>{{ 'funding.transparencyPage.support.copy' | translate }}</p>
        </div>
        <div class="support-actions">
          <div>
            <button
              type="button"
              *ngFor="let amount of contributionAmounts"
              [class.active]="selectedContributionAmount() === amount"
              (click)="selectedContributionAmount.set(amount)"
            >
              {{ amount }} $
            </button>
          </div>
          <label class="support-consent-option">
            <input
              type="checkbox"
              [checked]="nonCharityAcknowledged()"
              (change)="setNonCharityAcknowledged($event)"
            />
            <span>{{ 'funding.home.contribution.nonCharityNotice' | translate }}</span>
          </label>
          <button
            type="button"
            class="support-cta"
            [disabled]="!canStartCheckout()"
            (click)="supportProject()"
          >
            {{ 'funding.nav.supportCta' | translate }}
          </button>
          <p *ngIf="checkoutState() === 'loading'">
            {{ 'funding.transparencyPage.support.loading' | translate }}
          </p>
          <p class="state-success" *ngIf="checkoutState() === 'success'">
            {{ 'funding.transparencyPage.support.success' | translate }}
          </p>
          <p class="state-error" *ngIf="checkoutState() === 'error'">
            {{ 'funding.transparencyPage.support.error' | translate }}
          </p>
        </div>
      </section>

      <footer class="page-footer">
        <a
          class="page-footer-brand"
          [routerLink]="homePath()"
          [attr.aria-label]="'funding.aria.brandHome' | translate"
        >
          <span aria-hidden="true">⌬</span>
          <strong>OpenG7</strong>
        </a>
        <nav
          [attr.aria-label]="
            'funding.ecosystemPage.footer.secondaryLinksAria' | translate
          "
        >
          <a [routerLink]="aboutPath()">{{
            'funding.nav.about' | translate
          }}</a>
          <a [routerLink]="ecosystemPath()">{{
            'funding.ecosystemPage.footer.documentation' | translate
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

      <section class="loading-card" *ngIf="loading()">
        {{ 'funding.transparencyPage.state.loading' | translate }}
      </section>
      <section class="loading-card error" *ngIf="error()">
        {{ 'funding.transparencyPage.state.error' | translate }}
      </section>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
      background: #020914;
      color: #f9f2df;
      font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
    }

    .transparency-dashboard {
      background:
        radial-gradient(
          circle at 82% 2%,
          rgba(246, 185, 63, 0.14),
          transparent 20rem
        ),
        radial-gradient(
          circle at 20% 18%,
          rgba(20, 122, 210, 0.22),
          transparent 23rem
        ),
        linear-gradient(180deg, #031123 0%, #020914 100%);
      border: 1px solid rgba(226, 170, 65, 0.28);
      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.48);
      margin: 0 auto;
      max-width: 1530px;
      min-height: 100dvh;
      overflow: hidden;
      padding: 0 0 1rem;
    }

    .kpi-grid,
    .campaign-card,
    .dashboard-grid,
    .support-strip,
    .page-footer,
    .loading-card {
      margin-left: clamp(0.85rem, 4vw, 4.8rem);
      margin-right: clamp(0.85rem, 4vw, 4.8rem);
    }

    button {
      border: 0;
      border-radius: 0.42rem;
      cursor: pointer;
      min-height: 2.25rem;
    }

    .builders-nav .nav-contribute {
      border: 1px solid rgba(255, 232, 160, 0.85);
      border-radius: 0.45rem;
      min-height: 2.45rem;
      padding: 0 1.35rem;
    }

    .nav-cta,
    .hero-actions button,
    .support-cta {
      background: linear-gradient(180deg, #ffe58f, #dca33a);
      border: 1px solid rgba(255, 232, 160, 0.8);
      color: #06101e;
      font-weight: 900;
      padding: 0 1rem;
      text-transform: uppercase;
    }

    .nav-cta span {
      margin-left: 0.45rem;
    }

    .hero-panel {
      border-bottom: 1px solid rgba(226, 170, 65, 0.28);
      min-height: 25rem;
      overflow: hidden;
      padding-bottom: 1rem;
      position: relative;
    }

    .hero-city,
    .hero-dragon {
      height: 100%;
      object-fit: cover;
      position: absolute;
      top: 0;
    }

    .hero-city {
      inset-inline: 0;
      opacity: 0.82;
      width: 100%;
    }

    .hero-dragon {
      object-position: right center;
      opacity: 0.82;
      right: -3%;
      width: 55%;
    }

    .hero-overlay {
      background:
        linear-gradient(
          90deg,
          rgba(2, 9, 20, 0.94) 0%,
          rgba(2, 9, 20, 0.74) 34%,
          rgba(2, 9, 20, 0.18) 64%,
          rgba(2, 9, 20, 0.62) 100%
        ),
        linear-gradient(180deg, rgba(2, 9, 20, 0.18), rgba(2, 9, 20, 0.92));
      inset: 0;
      position: absolute;
    }

    .hero-copy {
      max-width: 31rem;
      padding: 2.2rem clamp(0.85rem, 4vw, 4.8rem) 0;
      position: relative;
      z-index: 1;
    }

    .hero-copy h1 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: clamp(2.6rem, 7vw, 4.4rem);
      line-height: 0.86;
      margin: 0;
      text-shadow: 0 5px 24px rgba(0, 0, 0, 0.76);
    }

    .hero-copy strong,
    .positive,
    .page-footer span:last-child {
      color: #f6bf48;
    }

    .hero-copy p {
      color: #fff3df;
      line-height: 1.35;
      margin: 1.05rem 0 0;
      max-width: 29rem;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
      margin-top: 1.35rem;
    }

    .hero-actions .secondary {
      background: rgba(4, 20, 39, 0.76);
      border-color: rgba(246, 191, 72, 0.44);
      color: #fff3df;
    }

    .sync-strip {
      display: grid;
      gap: 0.7rem;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin: 1.45rem clamp(0.85rem, 4vw, 4.8rem) 0;
      position: relative;
      z-index: 2;
    }

    .sync-strip div,
    .kpi-card,
    .panel,
    .campaign-card,
    .support-strip,
    .loading-card {
      background: rgba(3, 19, 38, 0.82);
      border: 1px solid rgba(102, 177, 232, 0.28);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.08),
        0 12px 34px rgba(0, 0, 0, 0.26);
    }

    .sync-strip div {
      border-radius: 0.65rem;
      padding: 0.55rem 0.65rem;
    }

    .sync-strip dt,
    .sync-strip dd {
      margin: 0;
    }

    .sync-strip dt {
      color: #b8c8d9;
      font-size: 0.68rem;
    }

    .sync-strip dd {
      color: #fff4da;
      font-size: 0.82rem;
      font-weight: 800;
      margin-top: 0.1rem;
    }

    .kpi-grid {
      display: grid;
      gap: 0.8rem;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      margin-top: 0.95rem;
    }

    .kpi-card {
      align-items: center;
      border-radius: 0.62rem;
      display: grid;
      gap: 0.75rem;
      grid-template-columns: auto 1fr;
      min-height: 8.2rem;
      padding: 1rem;
    }

    .kpi-icon {
      border-radius: 999px;
      display: grid;
      font-size: 1.6rem;
      height: 3rem;
      place-items: center;
      width: 3rem;
    }

    .kpi-card.blue .kpi-icon {
      background: rgba(24, 144, 255, 0.17);
      color: #5fd7ff;
    }

    .kpi-card.red .kpi-icon {
      background: rgba(248, 82, 82, 0.16);
      color: #ff756f;
    }

    .kpi-card.green .kpi-icon {
      background: rgba(35, 197, 115, 0.16);
      color: #63f49d;
    }

    .kpi-card.gold .kpi-icon {
      background: rgba(246, 191, 72, 0.15);
      color: #f6bf48;
    }

    .kpi-card h2 {
      color: #cfdceb;
      font-size: 0.86rem;
      font-weight: 600;
      margin: 0;
    }

    .kpi-card strong {
      display: block;
      font-size: 1.55rem;
      margin-top: 0.35rem;
    }

    .kpi-card.red strong,
    .negative {
      color: #ff6f65;
    }

    .kpi-card.green strong {
      color: #60f59c;
    }

    .kpi-card.gold strong {
      color: #f6bf48;
    }

    .kpi-card p {
      color: #b8c8d9;
      font-size: 0.78rem;
      margin: 0.28rem 0 0;
    }

    .campaign-card {
      background-image:
        linear-gradient(90deg, rgba(3, 19, 38, 0.92), rgba(3, 19, 38, 0.76)),
        url('/assets/fonds-des-batisseurs-dragon-coffre-fort.png');
      background-position:
        center,
        right 48%;
      background-size: cover;
      border-radius: 0.6rem;
      margin-top: 0.8rem;
      padding: 0.95rem 1.2rem;
    }

    .campaign-card header {
      align-items: end;
      display: flex;
      justify-content: space-between;
      text-transform: uppercase;
    }

    .campaign-card strong {
      color: #fff5db;
      font-size: 1.55rem;
    }

    .campaign-track {
      background: rgba(255, 255, 255, 0.11);
      border: 1px solid rgba(246, 191, 72, 0.32);
      border-radius: 999px;
      height: 1.55rem;
      margin-top: 0.7rem;
      overflow: hidden;
    }

    .campaign-track span {
      background: linear-gradient(90deg, #f2a925, #ffdf76);
      box-shadow: 0 0 28px rgba(246, 191, 72, 0.5);
      display: block;
      height: 100%;
    }

    .campaign-card p,
    .fine-print {
      color: #cfdceb;
      font-size: 0.84rem;
      margin: 0.55rem 0 0;
    }

    .dashboard-grid {
      display: grid;
      gap: 0.8rem;
      grid-template-columns: minmax(15rem, 0.85fr) minmax(26rem, 1.5fr) minmax(
          15rem,
          0.85fr
        );
      margin-top: 0.8rem;
    }

    .panel {
      border-radius: 0.62rem;
      min-width: 0;
      padding: 1rem;
    }

    .panel h2 {
      color: #fff2d7;
      font-size: 1rem;
      margin: 0 0 0.85rem;
      text-transform: uppercase;
    }

    .flow-panel ol {
      display: grid;
      gap: 0.65rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .flow-panel li {
      display: grid;
      gap: 0.55rem;
      grid-template-columns: auto 1fr;
    }

    .flow-panel li > span {
      border: 1px solid rgba(95, 215, 255, 0.5);
      border-radius: 999px;
      color: #5fd7ff;
      display: grid;
      height: 1.8rem;
      place-items: center;
      width: 1.8rem;
    }

    .flow-panel strong,
    .mini-table strong {
      color: #fff4da;
    }

    .flow-panel p,
    .about-panel p,
    .privacy-panel p,
    .platforms-panel p {
      color: #bdccdc;
      font-size: 0.82rem;
      line-height: 1.35;
      margin: 0.12rem 0 0;
    }

    .flow-panel dl {
      background: rgba(0, 0, 0, 0.18);
      border: 1px solid rgba(246, 191, 72, 0.22);
      border-radius: 0.55rem;
      display: grid;
      gap: 0.35rem;
      margin: 0.85rem 0 0;
      padding: 0.7rem;
    }

    .flow-panel dl div,
    .method-panel dl div {
      display: flex;
      justify-content: space-between;
    }

    .flow-panel dt,
    .flow-panel dd,
    .method-panel dt,
    .method-panel dd {
      color: #cfdceb;
      font-size: 0.8rem;
      margin: 0;
    }

    .flow-panel dd {
      color: #f6bf48;
      font-weight: 800;
    }

    .registry-panel {
      grid-row: span 2;
    }

    .registry-panel header {
      align-items: center;
      display: flex;
      gap: 1rem;
      justify-content: space-between;
    }

    .registry-panel header div {
      display: flex;
      gap: 0.35rem;
    }

    .registry-panel header button,
    .text-link,
    .reports-panel button {
      background: rgba(5, 28, 55, 0.9);
      border: 1px solid rgba(102, 177, 232, 0.24);
      color: #dceaff;
      font-size: 0.78rem;
      padding: 0 0.6rem;
    }

    .registry-panel header button.active {
      background: #1268a5;
      color: #fff;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      border-collapse: collapse;
      min-width: 760px;
      width: 100%;
    }

    th,
    td {
      border-bottom: 1px solid rgba(102, 177, 232, 0.16);
      color: #dce7f4;
      font-size: 0.76rem;
      padding: 0.58rem 0.45rem;
      text-align: left;
      white-space: nowrap;
    }

    th {
      color: #b8c8d9;
      font-size: 0.7rem;
      text-transform: uppercase;
    }

    .state-pill {
      border: 1px solid rgba(82, 230, 133, 0.35);
      border-radius: 0.35rem;
      color: #7ef0a2;
      padding: 0.12rem 0.38rem;
    }

    .state-pill.accounting {
      border-color: rgba(95, 215, 255, 0.35);
      color: #89dfff;
    }

    .empty-row {
      color: #b8c8d9;
      text-align: center;
    }

    .text-link {
      display: block;
      margin: 0.7rem auto 0;
    }

    .allocation-panel .donut {
      background: conic-gradient(
        #f4b53c 0 30%,
        #2f9fe5 30% 60%,
        #58d79a 60% 80%,
        #e5df80 80% 90%,
        #e58a3e 90% 100%
      );
      border-radius: 999px;
      height: 8rem;
      margin: 0 auto 0.75rem;
      position: relative;
      width: 8rem;
    }

    .allocation-panel .donut::after {
      background: #041326;
      border-radius: inherit;
      content: '';
      inset: 1.8rem;
      position: absolute;
    }

    .allocation-panel ul,
    .privacy-panel ul,
    .about-panel ul {
      display: grid;
      gap: 0.4rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .allocation-panel li {
      align-items: center;
      display: grid;
      gap: 0.45rem;
      grid-template-columns: auto auto 1fr;
    }

    .allocation-panel li span {
      border-radius: 999px;
      height: 0.7rem;
      width: 0.7rem;
    }

    .allocation-panel li strong {
      color: #f6bf48;
    }

    .allocation-panel li p,
    .about-panel li,
    .privacy-panel li {
      color: #cfdceb;
      font-size: 0.8rem;
      margin: 0;
    }

    .mini-table {
      display: grid;
      gap: 0.5rem;
    }

    .mini-table div {
      display: grid;
      gap: 0.55rem;
      grid-template-columns: minmax(4.2rem, auto) 1fr auto;
    }

    .mini-table span,
    .mini-table em {
      color: #cfdceb;
      font-size: 0.78rem;
      font-style: normal;
    }

    .info-box {
      border: 1px solid rgba(95, 215, 255, 0.28);
      border-radius: 0.48rem;
      color: #cfe8f8;
      font-size: 0.78rem;
      line-height: 1.35;
      margin: 0.8rem 0 0;
      padding: 0.65rem;
    }

    .platform-grid {
      display: grid;
      gap: 0.45rem;
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .platform-grid div {
      aspect-ratio: 1 / 1;
      border: 1px solid rgba(246, 191, 72, 0.32);
      border-radius: 0.45rem;
      overflow: hidden;
      position: relative;
    }

    .platform-grid img {
      height: 100%;
      object-fit: cover;
      width: 100%;
    }

    .platform-grid span {
      background: rgba(2, 9, 20, 0.82);
      border: 1px solid #f6bf48;
      border-radius: 999px;
      color: #f6bf48;
      display: grid;
      font-size: 0.68rem;
      height: 1.1rem;
      left: 0.2rem;
      place-items: center;
      position: absolute;
      top: 0.2rem;
      width: 1.1rem;
    }

    .platform-grid p {
      background: linear-gradient(180deg, transparent, rgba(2, 9, 20, 0.88));
      bottom: 0;
      color: #fff4da;
      font-size: 0.58rem;
      left: 0;
      margin: 0;
      padding: 1rem 0.22rem 0.25rem;
      position: absolute;
      right: 0;
      text-align: center;
    }

    .method-panel strong {
      border-top: 1px solid rgba(102, 177, 232, 0.2);
      color: #fff4da;
      display: block;
      margin-top: 0.75rem;
      padding-top: 0.55rem;
    }

    .method-panel p {
      color: #9fb4c8;
      font-size: 0.78rem;
      margin: 0.65rem 0 0;
    }

    .privacy-panel {
      grid-column: span 1;
    }

    .privacy-columns {
      display: grid;
      gap: 0.8rem;
      grid-template-columns: 1fr 1fr;
    }

    .privacy-panel li::before {
      color: #68eca2;
      content: '✓ ';
    }

    .privacy-panel ul:last-child li::before {
      color: #b8c8d9;
      content: '🔒 ';
    }

    .reports-panel {
      display: grid;
      gap: 0.6rem;
    }

    .reports-panel h2 {
      margin-bottom: 0.2rem;
    }

    .about-panel ul {
      margin-top: 0.7rem;
    }

    .support-strip {
      align-items: center;
      border-radius: 0.62rem;
      display: grid;
      gap: 1rem;
      grid-template-columns: 8rem 1fr minmax(18rem, 0.95fr);
      margin-top: 0.8rem;
      padding: 0.75rem;
    }

    .support-strip img {
      border-radius: 0.5rem;
      height: 5rem;
      object-fit: cover;
      width: 7.5rem;
    }

    .support-strip h2 {
      font-size: 1rem;
      margin: 0;
    }

    .support-strip p {
      color: #f6bf48;
      margin: 0.25rem 0 0;
    }

    .support-actions {
      display: grid;
      gap: 0.45rem;
    }

    .support-actions div {
      display: grid;
      gap: 0.45rem;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .support-actions div button {
      background: #fff2d2;
      color: #07101b;
      font-weight: 800;
    }

    .support-actions div button.active {
      background: #f6bf48;
    }

    .support-consent-option {
      align-items: flex-start;
      background: rgba(2, 10, 23, 0.36);
      border: 1px solid rgba(246, 191, 72, 0.3);
      border-radius: 0.45rem;
      display: flex;
      gap: 0.42rem;
      padding: 0.45rem 0.5rem;
    }

    .support-consent-option input {
      accent-color: #f6bf48;
      flex: 0 0 auto;
      margin-top: 0.1rem;
    }

    .support-consent-option span {
      color: #cfdceb;
      font-size: 0.72rem;
      line-height: 1.35;
    }

    .support-cta:disabled {
      cursor: not-allowed;
      filter: grayscale(0.35);
      opacity: 0.55;
    }

    .page-footer {
      align-items: center;
      background: rgba(2, 10, 23, 0.94);
      border-top: 1px solid rgba(72, 163, 230, 0.24);
      color: #f6fbff;
      display: grid;
      gap: 1rem;
      grid-template-columns: minmax(12rem, 0.8fr) minmax(20rem, 1.3fr) auto;
      margin-left: 0;
      margin-right: 0;
      padding: 0.8rem clamp(1rem, 3vw, 3.25rem);
    }

    .page-footer-brand,
    .page-footer nav a {
      color: #f6fbff;
      text-decoration: none;
    }

    .page-footer-brand {
      align-items: center;
      display: inline-flex;
      gap: 0.65rem;
    }

    .page-footer-brand span {
      color: #f6bf48;
      font-size: 1.55rem;
    }

    .page-footer-brand strong {
      font-size: 1.45rem;
    }

    .page-footer nav {
      display: flex;
      gap: 2rem;
      justify-content: center;
    }

    .page-footer nav a {
      font-weight: 800;
    }

    .page-footer small {
      color: #9eb5c8;
    }

    .loading-card {
      border-radius: 0.62rem;
      margin-top: 0.8rem;
      padding: 1rem;
      text-align: center;
    }

    .error,
    .state-error {
      color: #ff9b91;
    }

    @media (max-width: 1120px) {
      .dashboard-grid,
      .support-strip,
      .page-footer {
        grid-template-columns: 1fr;
      }

      .page-footer nav {
        justify-content: flex-start;
        overflow-x: auto;
      }

      .kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .sync-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .hero-panel {
        min-height: auto;
        padding-bottom: 1rem;
      }
    }

    @media (max-width: 680px) {
      .transparency-dashboard {
        padding: 0 0.75rem 1rem;
      }

      .hero-dragon {
        opacity: 0.35;
        width: 100%;
      }

      .hero-copy h1 {
        font-size: 2.6rem;
      }

      .kpi-grid,
      .sync-strip,
      .privacy-columns,
      .support-actions div {
        grid-template-columns: 1fr;
      }

      .platform-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
  `
})
export class FundingTransparencyPageComponent implements OnInit {
  private readonly transparencyService = inject(FundTransparencyService);
  private readonly fundingService = inject(FundingService);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly seo = inject(FundingSeoService);
  private readonly i18n = inject(FundingI18nService);

  constructor() {
    this.seo.bind(
      {
        titleKey: 'funding.seo.transparency.title',
        descriptionKey: 'funding.seo.transparency.description',
        path: '/fonds-des-batisseurs/transparence',
        imagePath: '/assets/fonds-des-batisseurs-feuille-erable-lumineuse.png'
      },
      this.injector
    );
  }

  readonly data = signal<FundTransparencyPublicResponse | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<boolean>(false);
  readonly registryFilter = signal<'all' | 'contributions' | 'fees'>('all');
  readonly selectedContributionAmount = signal<number>(25);
  readonly checkoutState = signal<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  readonly nonCharityAcknowledged = signal<boolean>(false);

  readonly report = computed<FundTransparencyPublicResponse>(
    () => this.data() ?? emptyReport()
  );

  readonly homePath = computed(() => this.i18n.localizedPath('/'));
  readonly aboutPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/a-propos')
  );
  readonly ecosystemPath = computed(() =>
    this.i18n.localizedPath('/ecosystem')
  );
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly currentYear = new Date().getFullYear();

  readonly contributionAmounts = [5, 10, 25, 50] as const;
  readonly monthlyGoal = 1500;
  readonly canStartCheckout = computed<boolean>(
    () => this.nonCharityAcknowledged() && this.checkoutState() !== 'loading'
  );

  readonly setupFacts = computed<readonly SetupFact[]>(() => [
    {
      labelKey: 'funding.home.purpose.lastSync',
      value: this.lastUpdatedLabel()
    },
    {
      labelKey: 'funding.home.purpose.source',
      value: this.transparencySourceLabel()
    },
    {
      labelKey: 'funding.home.purpose.currency',
      value: this.report().currency
    },
    {
      labelKey: 'funding.home.purpose.activeCampaign',
      valueKey: 'funding.transparencyPage.sync.activeCampaignValue'
    }
  ]);

  readonly kpiCards = computed<readonly KpiCard[]>(() => {
    const report = this.report();

    const cards: readonly KpiCard[] = [
      {
        labelKey: 'funding.transparency.confirmed',
        value: report.total_received,
        detailKey: 'funding.transparencyPage.kpis.contributionCount',
        detailParams: { count: report.contributions_count },
        tone: 'blue',
        kind: 'currency'
      },
      {
        labelKey: 'funding.home.purpose.paymentFees',
        value: report.total_fees,
        detailKey: 'funding.transparencyPage.kpis.totalFees',
        tone: 'red',
        kind: 'currency'
      },
      {
        labelKey: 'funding.transparencyPage.kpis.refunds',
        value: report.total_refunded,
        detailKey: 'funding.transparencyPage.kpis.totalRefunded',
        tone: 'red',
        kind: 'currency'
      },
      {
        labelKey: 'funding.home.purpose.netAvailable',
        value: report.current_available_estimate,
        detailKey: 'funding.transparencyPage.kpis.availableForProjects',
        tone: 'green',
        kind: 'currency'
      },
      {
        labelKey: 'funding.goal.monthly',
        value: this.monthlyGoal,
        detailKey: 'funding.transparencyPage.kpis.monthlyProgress',
        detailParams: { progress: this.monthlyProgress() },
        tone: 'gold',
        kind: 'currency'
      }
    ];

    return cards;
  });

  readonly visibleRegistryRows = computed<readonly PublicMonthlySummary[]>(
    () => {
      const filter = this.registryFilter();
      if (filter === 'fees') {
        return [];
      }

      return this.report().monthly_summary.filter(
        (row) => row.total_received > 0
      );
    }
  );

  readonly visibleFeeRows = computed<readonly PublicMonthlySummary[]>(() => {
    const filter = this.registryFilter();
    if (filter === 'contributions') {
      return [];
    }

    return this.report().monthly_summary.filter((row) => row.total_fees !== 0);
  });

  readonly publicAllocations = computed(
    () => this.report().latest_public_allocations
  );

  readonly platforms: readonly PlatformMiniCard[] = [
    {
      id: 1,
      name: 'Social',
      asset: 'assets/openg7-social-communautes-connectees-canada.png'
    },
    {
      id: 2,
      name: 'Migration Flow',
      asset: 'assets/openg7-migration-flow-engine-canada.png'
    },
    {
      id: 3,
      name: 'Firewall',
      asset: 'assets/openg7-firewall-cybersecurite-canada.png'
    },
    {
      id: 4,
      name: 'Election Ops',
      asset: 'assets/openg7-ca-election-day-ops-results-audit.png'
    },
    {
      id: 5,
      name: 'Voter Register',
      asset: 'assets/openg7-ca-voter-register-official-docs.png'
    },
    {
      id: 6,
      name: 'Vehicle Registry',
      asset: 'assets/openg7-canadian-vehicle-registry.png'
    },
    {
      id: 7,
      name: 'GovGraph',
      asset: 'assets/openg7-govgraph-gouvernance-canada.png'
    },
    {
      id: 8,
      name: 'Nexus',
      asset: 'assets/openg7-nexus-carte-canada-connecte.png'
    },
    {
      id: 9,
      name: 'Patient Navigation',
      asset: 'assets/openg7-patient-navigation-canada.png'
    },
    {
      id: 10,
      name: 'Medical Referral',
      asset: 'assets/openg7-medical-referral-router-canada.png'
    },
    {
      id: 11,
      name: 'Clinical Workforce',
      asset: 'assets/openg7-clinical-workforce-exchange-canada.png'
    },
    {
      id: 12,
      name: 'Health Supply',
      asset: 'assets/openg7-health-supply-corridors-canada.png'
    },
    {
      id: 13,
      name: 'Funding Platform',
      asset: 'assets/openg7-funding-platform-dragon-coffre.png'
    }
  ];

  readonly flowSteps: readonly FlowStep[] = [
    {
      titleKey: 'funding.transparencyPage.flow.steps.contribution.title',
      descriptionKey:
        'funding.transparencyPage.flow.steps.contribution.description'
    },
    {
      titleKey: 'funding.transparencyPage.flow.steps.confirmed.title',
      descriptionKey:
        'funding.transparencyPage.flow.steps.confirmed.description'
    },
    {
      titleKey: 'funding.transparencyPage.flow.steps.fees.title',
      descriptionKey: 'funding.transparencyPage.flow.steps.fees.description'
    },
    {
      titleKey: 'funding.transparencyPage.flow.steps.refunds.title',
      descriptionKey: 'funding.transparencyPage.flow.steps.refunds.description'
    },
    {
      titleKey: 'funding.transparencyPage.flow.steps.net.title',
      descriptionKey: 'funding.transparencyPage.flow.steps.net.description'
    }
  ] as const;

  readonly allocationPlan: readonly AllocationPlanItem[] = [
    {
      labelKey: 'funding.transparencyPage.allocation.items.infrastructure',
      share: 30,
      color: '#f4b53c'
    },
    {
      labelKey: 'funding.transparencyPage.allocation.items.development',
      share: 30,
      color: '#2f9fe5'
    },
    {
      labelKey: 'funding.transparencyPage.allocation.items.security',
      share: 20,
      color: '#58d79a'
    },
    {
      labelKey: 'funding.transparencyPage.allocation.items.data',
      share: 10,
      color: '#e5df80'
    },
    {
      labelKey: 'funding.transparencyPage.allocation.items.community',
      share: 5,
      color: '#e58a3e'
    },
    {
      labelKey: 'funding.transparencyPage.allocation.items.reserve',
      share: 5,
      color: '#9b7ff0'
    }
  ] as const;

  readonly calculationRows: readonly CalculationRow[] = [
    { labelKey: 'funding.transparency.confirmed', sign: '+' },
    { labelKey: 'funding.home.purpose.paymentFees', sign: '-' },
    { labelKey: 'funding.transparencyPage.kpis.refunds', sign: '-' },
    { labelKey: 'funding.transparencyPage.method.disputedAmounts', sign: '-' }
  ];

  readonly publicDataChecklist = [
    'funding.transparencyPage.privacy.publicData.aggregateAmounts',
    'funding.transparencyPage.privacy.publicData.fees',
    'funding.transparencyPage.privacy.publicData.refunds',
    'funding.transparencyPage.privacy.publicData.goals',
    'funding.transparencyPage.privacy.publicData.plannedUse',
    'funding.transparencyPage.privacy.publicData.publishedExpenses',
    'funding.transparencyPage.privacy.publicData.syncDate'
  ] as const;

  readonly protectedDataChecklist = [
    'funding.transparencyPage.privacy.protectedData.contributorIdentity',
    'funding.transparencyPage.privacy.protectedData.paymentDetails',
    'funding.transparencyPage.privacy.protectedData.bankData',
    'funding.transparencyPage.privacy.protectedData.addresses',
    'funding.transparencyPage.privacy.protectedData.personalData',
    'funding.transparencyPage.privacy.protectedData.technicalIdentifiers'
  ] as const;

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    try {
      const report = await this.transparencyService.getPublicTransparency();
      this.data.set(report);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  monthlyProgress(): number {
    return Math.min(
      100,
      Math.round((this.report().total_received / this.monthlyGoal) * 1000) / 10
    );
  }

  remainingForGoal(): number {
    return Math.max(0, this.monthlyGoal - this.report().total_received);
  }

  kpiIcon(tone: KpiCard['tone']): string {
    const icons: Record<KpiCard['tone'], string> = {
      blue: '●',
      red: '↺',
      green: '▣',
      gold: '↗'
    };

    return icons[tone];
  }

  lastUpdatedLabel(): string {
    const language = this.i18n.currentLanguage();
    const date = new Date(this.report().last_updated_at);
    if (Number.isNaN(date.getTime())) {
      return this.i18n.t('funding.transparencyPage.sync.pending');
    }

    return date.toLocaleDateString(language, {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  transparencySourceLabel(): string {
    const source = this.report().data_source;
    if (source === 'database') {
      return 'PostgreSQL';
    }

    if (source === 'stripe_direct') {
      return 'Stripe direct';
    }

    return this.i18n.t('funding.home.sync.pending');
  }

  scrollToRegistry(): void {
    document.getElementById('public-registry')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  scrollToSupport(): void {
    document.getElementById('support')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }

  async supportProject(): Promise<void> {
    if (!this.nonCharityAcknowledged()) {
      this.checkoutState.set('error');
      return;
    }

    this.checkoutState.set('loading');
    try {
      const result = await this.fundingService.startCheckout(
        this.selectedContributionAmount(),
        {
          contributionType: 'personal_support',
          publicDisplayConsent: false,
          displayAmountConsent: false,
          nonCharityAcknowledged: this.nonCharityAcknowledged()
        }
      );

      if (result.status === 'redirected') {
        window.location.assign(result.redirectUrl);
        return;
      }

      this.checkoutState.set('success');
    } catch {
      this.checkoutState.set('error');
    }
  }

  setNonCharityAcknowledged(event: Event): void {
    this.nonCharityAcknowledged.set(
      Boolean((event.target as HTMLInputElement | null)?.checked)
    );
  }

  downloadReport(): void {
    const blob = new Blob([JSON.stringify(this.report(), null, 2)], {
      type: 'application/json'
    });
    this.downloadBlob(blob, 'openg7-transparence-fonds-batisseurs.json');
  }

  downloadCsv(): void {
    const rows = [
      [
        'month',
        'total_received',
        'total_fees',
        'total_net',
        'total_refunded',
        'total_payouts',
        'contributions_count'
      ],
      ...this.report().monthly_summary.map((row) => [
        row.month,
        row.total_received.toString(),
        row.total_fees.toString(),
        row.total_net.toString(),
        row.total_refunded.toString(),
        row.total_payouts.toString(),
        row.contributions_count.toString()
      ])
    ];
    const csv = rows.map((row) => row.join(',')).join('\n');
    this.downloadBlob(
      new Blob([csv], { type: 'text/csv' }),
      'openg7-registre-public.csv'
    );
  }

  async copyTransparencyLink(): Promise<void> {
    await navigator.clipboard.writeText(window.location.href);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
