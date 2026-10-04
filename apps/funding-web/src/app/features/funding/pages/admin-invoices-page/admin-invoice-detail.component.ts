import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorshipCreditNoteRecord,
  AdminSponsorshipInvoiceRecord
} from '@openg7/funding-core';

import { AdminDocumentDeliveryComponent } from './admin-document-delivery.component.js';
import { AdminDocumentEmailStatusComponent } from './admin-document-email-status.component.js';
import type {
  AdminCreditNoteView,
  AdminDocumentRecipientChange,
  AdminInvoiceDetailView
} from './admin-invoice.models.js';

/** Admin organism: the invoice snapshot, credit notes and document actions. */
@Component({
  selector: 'openg7-admin-invoice-detail',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    AdminDocumentDeliveryComponent,
    AdminDocumentEmailStatusComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-invoice-detail.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-invoice-detail.component.css'
  ]
})
export class AdminInvoiceDetailComponent {
  readonly canManage = input(true);
  readonly view = input.required<AdminInvoiceDetailView | null>();
  readonly invoiceDownload = output<AdminSponsorshipInvoiceRecord>();
  readonly invoiceInspection = output<AdminSponsorshipInvoiceRecord>();
  readonly invoiceResend = output<AdminSponsorshipInvoiceRecord>();
  readonly invoiceRecipientChange = output<AdminDocumentRecipientChange>();
  readonly creditNoteDownload = output<AdminSponsorshipCreditNoteRecord>();
  readonly creditNoteResend = output<AdminSponsorshipCreditNoteRecord>();
  readonly creditNoteRecipientChange = output<AdminDocumentRecipientChange>();

  trackByCreditNote(_index: number, creditNote: AdminCreditNoteView): string {
    return creditNote.record.id;
  }
}
