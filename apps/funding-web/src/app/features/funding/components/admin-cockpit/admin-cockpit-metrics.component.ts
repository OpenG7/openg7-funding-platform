import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminMetricCardComponent } from '../admin-ui/admin-metric-card.component.js';

import { AdminCockpitStatusComponent } from './admin-cockpit-status.component.js';
import { AdminCockpitTrendComponent } from './admin-cockpit-trend.component.js';
import { createCockpitBlock } from './cockpit-block.js';

@Component({
  selector: 'openg7-admin-cockpit-metrics',
  standalone: true,
  imports: [
    TranslatePipe,
    AdminMetricCardComponent,
    AdminCockpitStatusComponent,
    AdminCockpitTrendComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-cockpit-metrics.component.html',
  styleUrls: ['./admin-cockpit.css']
})
export class AdminCockpitMetricsComponent {
  readonly refreshKey = input(0);
  readonly block = createCockpitBlock('metrics', this.refreshKey);
  readonly i18n = inject(FundingI18nService);
  readonly currency = signal('CAD');
  readonly selected = computed(
    () =>
      this.block
        .data()
        ?.currencies.find((c) => c.currency === this.currency()) ??
      this.block.data()?.currencies[0]
  );
  money(value: number | null): string {
    if (value === null) return this.i18n.t('admin.dashboard.notAvailable');
    const currency = this.selected()?.currency ?? 'CAD';
    const digits =
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency
      }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency
    }).format(value / 10 ** digits);
  }
  count(value: number | null): string {
    return value === null
      ? this.i18n.t('admin.dashboard.notAvailable')
      : new Intl.NumberFormat(this.i18n.currentLanguage()).format(value);
  }
  date(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'America/Toronto',
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  }
}
