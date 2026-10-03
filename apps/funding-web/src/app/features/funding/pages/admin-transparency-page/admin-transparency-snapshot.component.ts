import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminTransparencyResponse } from '@openg7/funding-core';

import type {
  AdminTransparencyDateFormatter,
  AdminTransparencyMoneyFormatter
} from './admin-transparency-presentation.models.js';

/** Admin organism: presents the current public snapshot without loading or computing it. */
@Component({
  selector: 'openg7-admin-transparency-snapshot',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-transparency-snapshot.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-transparency-panels.css',
    './admin-transparency-snapshot.component.css'
  ]
})
export class AdminTransparencySnapshotComponent {
  readonly publicSummary =
    input.required<AdminTransparencyResponse['public_summary']>();
  readonly lastUpdatedAt = input.required<string>();
  readonly formatMoney = input.required<AdminTransparencyMoneyFormatter>();
  readonly dateLabel = input.required<AdminTransparencyDateFormatter>();
}
