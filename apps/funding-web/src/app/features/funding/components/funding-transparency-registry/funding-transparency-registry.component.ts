import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import type { PublicMonthlySummary } from '@openg7/funding-core';

import type { TransparencyRegistryFilter } from '../../models/funding-transparency.utils.js';

interface TransparencyRegistryRow {
  readonly id: string;
  readonly month: string;
  readonly currency: string;
  readonly type: Exclude<TransparencyRegistryFilter, 'all'>;
  readonly amount: number;
}

@Component({
  selector: 'openg7-funding-transparency-registry',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-transparency-registry.component.html',
  styleUrl: './funding-transparency-registry.component.css'
})
export class FundingTransparencyRegistryComponent {
  readonly monthlySummary = input.required<readonly PublicMonthlySummary[]>();
  readonly availableMonths = input.required<readonly string[]>();
  readonly period = input.required<string>();
  readonly filter = input.required<TransparencyRegistryFilter>();
  readonly hasSnapshot = input.required<boolean>();
  readonly loading = input.required<boolean>();
  readonly periodUnavailable = input.required<boolean>();
  readonly formatMoney =
    input.required<(value: number, currency: string) => string>();
  readonly periodChange = output<string>();
  readonly filterChange = output<TransparencyRegistryFilter>();

  readonly registryFilters: readonly TransparencyRegistryFilter[] = [
    'all',
    'contributions',
    'fees',
    'refunds'
  ];
  readonly registryRows = computed<readonly TransparencyRegistryRow[]>(() => {
    if (!this.hasSnapshot()) return [];
    return this.monthlySummary()
      .filter((row) => this.period() === 'all' || row.month === this.period())
      .flatMap((row) =>
        [
          { type: 'contributions' as const, amount: row.total_received },
          { type: 'fees' as const, amount: row.total_fees },
          { type: 'refunds' as const, amount: row.total_refunded }
        ]
          .filter(
            (entry) =>
              entry.amount !== 0 &&
              (this.filter() === 'all' || this.filter() === entry.type)
          )
          .map((entry) => ({
            ...entry,
            id: `${row.month}-${entry.type}`,
            month: row.month,
            currency: row.currency
          }))
      );
  });
  readonly emptyStateKey = computed(() =>
    this.hasSnapshot() && !this.periodUnavailable()
      ? 'funding.transparencyPage.registry.empty'
      : 'funding.transparencyPage.state.unavailable'
  );
}
