import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipInvoiceRecord } from '@openg7/funding-core';

import { AdminDocumentEmailStatusComponent } from './admin-document-email-status.component.js';
import type { AdminInvoiceListRow } from './admin-invoice.models.js';

/** Admin organism: invoice navigation, with selection owned by the page. */
@Component({
  selector: 'openg7-admin-invoice-list',
  standalone: true,
  imports: [CommonModule, TranslatePipe, AdminDocumentEmailStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-invoice-list.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-invoice-list.component.css'
  ]
})
export class AdminInvoiceListComponent {
  readonly rows = input.required<readonly AdminInvoiceListRow[]>();
  readonly selectedId = input.required<string>();
  readonly selected = output<AdminSponsorshipInvoiceRecord>();

  trackByRow(_index: number, row: AdminInvoiceListRow): string {
    return row.invoice.id;
  }
}
