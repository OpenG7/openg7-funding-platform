import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminSponsorAuditHistoryView } from '../../models/admin-sponsors-ui.models.js';

/** Dossier audit presentation; inspection is delegated to the page. */
@Component({
  selector: 'openg7-admin-sponsor-audit-history',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-audit-history.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-sponsor-audit-history.component.css'
  ]
})
export class AdminSponsorAuditHistoryComponent {
  readonly view = input.required<AdminSponsorAuditHistoryView>();
  readonly inspect = output<void>();
}
