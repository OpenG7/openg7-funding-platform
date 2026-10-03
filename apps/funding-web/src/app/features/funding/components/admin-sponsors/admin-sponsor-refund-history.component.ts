import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminSponsorRefundHistoryView } from '../../models/admin-sponsors-ui.models.js';

/** Read-only refund milestones and audit projected from server-confirmed facts. */
@Component({
  selector: 'openg7-admin-sponsor-refund-history',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-refund-history.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    './admin-sponsor-refund-history.component.css'
  ]
})
export class AdminSponsorRefundHistoryComponent {
  readonly view = input.required<AdminSponsorRefundHistoryView>();
}
