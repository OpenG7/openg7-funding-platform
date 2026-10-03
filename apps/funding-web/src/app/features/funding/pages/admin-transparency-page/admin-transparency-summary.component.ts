import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminTransparencyResponse } from '@openg7/funding-core';

import type { AdminTransparencyMoneyFormatter } from './admin-transparency-presentation.models.js';

/** Admin organism: displays server-confirmed financial and allocation summaries. */
@Component({
  selector: 'openg7-admin-transparency-summary',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-transparency-summary.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-transparency-summary.component.css'
  ]
})
export class AdminTransparencySummaryComponent {
  readonly publicSummary =
    input.required<AdminTransparencyResponse['public_summary']>();
  readonly expensesSummary =
    input.required<AdminTransparencyResponse['expenses_summary']>();
  readonly formatMoney = input.required<AdminTransparencyMoneyFormatter>();
}
