import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminExpenseRecord } from '@openg7/funding-core';

import type {
  AdminTransparencyDateFormatter,
  AdminTransparencyMoneyFormatter
} from './admin-transparency-presentation.models.js';

/** Admin organism: reads the allocations selected by the page without mutating them. */
@Component({
  selector: 'openg7-admin-transparency-allocations',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-transparency-allocations.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-transparency-panels.css',
    './admin-transparency-allocations.component.css'
  ]
})
export class AdminTransparencyAllocationsComponent {
  readonly publishedExpenses = input.required<readonly AdminExpenseRecord[]>();
  readonly formatMoney = input.required<AdminTransparencyMoneyFormatter>();
  readonly dateLabel = input.required<AdminTransparencyDateFormatter>();

  trackByExpense(_: number, expense: AdminExpenseRecord): string {
    return expense.id;
  }
}
