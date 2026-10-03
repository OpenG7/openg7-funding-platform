import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipRecord } from '@openg7/funding-core';

import type { AdminSponsorRefundFieldChange } from '../../models/admin-sponsor-dossier-panels.js';
import type { SponsorRefundDraft } from '../../models/admin-sponsor-workflow.ports.js';

/** Funding organism: refund confirmation; validation and execution stay in the workflow. */
@Component({
  selector: 'openg7-admin-sponsor-refund-panel',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-refund-panel.component.html',
  styleUrls: [
    '../admin-ui/admin-forms.css',
    './admin-sponsor-refund-panel.component.css'
  ]
})
export class AdminSponsorRefundPanelComponent {
  readonly sponsorship = input.required<AdminSponsorshipRecord>();
  readonly draft = input.required<SponsorRefundDraft>();
  readonly confirmationText = input.required<string>();
  readonly draftAmountLabel = input.required<string>();
  readonly paymentAmountLabel = input.required<string>();
  readonly validationMessage = input.required<string>();
  readonly canConfirm = input.required<boolean>();
  readonly actionsDisabled = input.required<boolean>();
  readonly pending = input.required<boolean>();
  readonly busy = input.required<boolean>();

  readonly draftFieldChange = output<AdminSponsorRefundFieldChange>();
  readonly reasonChange = output<Event>();
  readonly notifySponsorChange = output<Event>();
  readonly cancelled = output<void>();
  readonly confirmed = output<void>();

  private readonly refundAmountInput =
    viewChild<ElementRef<HTMLInputElement>>('refundAmountInput');

  focusAmount(): void {
    this.refundAmountInput()?.nativeElement.focus();
  }
}
