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
  templateUrl: './admin-cockpit-trend.component.html',
  styleUrl: './admin-cockpit-trend.component.css'
})
export class AdminCockpitTrendComponent {
  readonly trend = input.required<CockpitTrend>();
  readonly currency = input<string>();
  readonly i18n = inject(FundingI18nService);
  readonly dailyValues = computed(() => [...this.trend().series].reverse());
  readonly chart = computed(() => {
    const series = this.trend().series;
    const values = series.map((p) => p.value);
    if (values.length < 2 || values.some((v) => v === null)) return null;
    const amounts = values as number[];
    const min = Math.min(0, ...amounts);
    const max = Math.max(1, ...amounts);
    const y = (value: number) => 80 - ((value - min) / (max - min)) * 72;
    const points = amounts
      .map(
        (value, index) =>
          `${(index * 292) / (amounts.length - 1) + 4},${y(value)}`
      )
      .join(' ');
    return {
      points,
      area: `4,${y(0)} ${points} 296,${y(0)}`,
      zero: y(0),
      start: series[0]!.day,
      end: series[series.length - 1]!.day
    };
  });
  readonly direction = computed(() => {
    const percent = this.trend().percent;
    if (percent === null) return 'unknown';
    return percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat';
  });
  readonly comparisonHint = computed(() => {
    const { current, previous, percent } = this.trend();
    if (percent !== null) return null;
    if (current === 0 && previous === 0) return 'admin.cockpit.zeroPeriodsHelp';
    if (current !== null && previous === 0)
      return 'admin.cockpit.zeroBaselineHelp';
    return 'admin.cockpit.missingComparisonHelp';
  });

  percentage(): string {
    const { current, previous, percent } = this.trend();
    if (percent === null) {
      return this.i18n.t(
        current === 0 && previous === 0
          ? 'admin.cockpit.zeroPeriods'
          : current !== null && previous === 0
            ? 'admin.cockpit.noBaseline'
            : 'admin.cockpit.noComparison'
      );
    }
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'percent',
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero'
    }).format(percent / 100);
  }

  date(day: string, includeYear = false): string {
    // API dates are calendar days, not instants in the browser's time zone.
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      ...(includeYear ? { year: 'numeric' as const } : {})
    }).format(new Date(`${day}T00:00:00Z`));
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
