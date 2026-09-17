import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { CockpitTrend } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

@Component({
  selector: 'openg7-admin-cockpit-trend',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (points()) {
      <svg viewBox="0 0 160 38" aria-hidden="true">
        <polyline [attr.points]="points()" />
      </svg>
    }
    <p>
      {{ 'admin.cockpit.comparison' | translate }} :
      <strong>{{ percentage() }}</strong>
    </p>
    <details>
      <summary>{{ 'admin.cockpit.series' | translate }}</summary>
      <p>
        {{ 'admin.cockpit.currentPeriod' | translate }} :
        {{ format(trend().current) }}<br />{{
          'admin.cockpit.previousPeriod' | translate
        }}
        : {{ format(trend().previous) }}
      </p>
      <div class="table-scroll">
        <table>
          <caption>
            {{
              'admin.cockpit.dailySeries' | translate
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ 'admin.cockpit.day' | translate }}</th>
              <th scope="col">{{ 'admin.cockpit.value' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (point of trend().series; track point.day) {
              <tr>
                <th scope="row">{{ point.day }}</th>
                <td>{{ format(point.value) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </details>
  `,
  styles: [
    `
      :host {
        display: block;
        font-size: 0.78rem;
        color: var(--admin-muted);
        padding: 0.6rem 1rem;
      }
      svg {
        width: 100%;
        height: 38px;
      }
      polyline {
        fill: none;
        stroke: var(--admin-gold, #f4c66a);
        stroke-width: 2;
      }
      p {
        margin: 0.3rem 0;
      }
      summary {
        cursor: pointer;
      }
      summary:focus-visible {
        outline: 2px solid #f4c66a;
      }
      .table-scroll {
        max-height: 15rem;
        overflow: auto;
      }
      table {
        width: 100%;
        text-align: left;
      }
      td {
        text-align: right;
      }
    `
  ]
})
export class AdminCockpitTrendComponent {
  readonly trend = input.required<CockpitTrend>();
  readonly currency = input<string>();
  readonly i18n = inject(FundingI18nService);
  readonly points = computed(() => {
    const values = this.trend().series.map((p) => p.value);
    if (values.length < 2 || values.some((v) => v === null)) return '';
    const amounts = values as number[];
    const min = Math.min(0, ...amounts);
    const max = Math.max(1, ...amounts);
    return amounts
      .map(
        (value, index) =>
          `${(index * 156) / (amounts.length - 1) + 2},${36 - ((value - min) / (max - min)) * 32}`
      )
      .join(' ');
  });
  percentage(): string {
    const percent = this.trend().percent;
    return percent === null
      ? this.i18n.t('admin.cockpit.noComparison')
      : new Intl.NumberFormat(this.i18n.currentLanguage(), {
          style: 'percent',
          maximumFractionDigits: 1,
          signDisplay: 'exceptZero'
        }).format(percent / 100);
  }
  format(value: number | null): string {
    if (value === null) return this.i18n.t('admin.dashboard.notAvailable');
    const currency = this.currency();
    const digits = currency
      ? (new Intl.NumberFormat('en', {
          style: 'currency',
          currency
        }).resolvedOptions().maximumFractionDigits ?? 2)
      : 0;
    return new Intl.NumberFormat(
      this.i18n.currentLanguage(),
      currency ? { style: 'currency', currency } : {}
    ).format(currency ? value / 10 ** digits : value);
  }
}
