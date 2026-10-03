import { NgIf } from '@angular/common';
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

import type { AdminSponsorApprovalState } from '../../models/admin-sponsor-dossier-panels.js';

/** Funding organism: permitted dossier action intentions and server-backed feedback. */
@Component({
  selector: 'openg7-admin-sponsor-decision-actions',
  standalone: true,
  imports: [NgIf, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-decision-actions.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-decision-actions.component.css',
    './admin-sponsor-decision-approval.css'
  ]
})
export class AdminSponsorDecisionActionsComponent {
  readonly sponsorship = input.required<AdminSponsorshipRecord>();
  readonly financeTab = input.required<boolean>();
  readonly ownerActions = input.required<boolean>();
  readonly actionsDisabled = input.required<boolean>();
  readonly canApprove = input.required<boolean>();
  readonly canRefund = input.required<boolean>();
  readonly approvalState = input.required<AdminSponsorApprovalState>();
  readonly reviewMessage = input.required<string>();
  readonly anchor = input<string | null>(null);

  readonly returnPending = output<void>();
  readonly openRejection = output<void>();
  readonly openRefund = output<void>();
  readonly approve = output<void>();

  private readonly rejectButton =
    viewChild<ElementRef<HTMLButtonElement>>('rejectButton');
  private readonly refundButton =
    viewChild<ElementRef<HTMLButtonElement>>('refundButton');
  private readonly approvalButton =
    viewChild<ElementRef<HTMLButtonElement>>('approvalButton');

  focusRejectButton(): void {
    this.rejectButton()?.nativeElement.focus({ preventScroll: true });
  }

  focusRefundButton(): void {
    this.refundButton()?.nativeElement.focus({ preventScroll: true });
  }

  focusApprovalButton(): void {
    this.approvalButton()?.nativeElement.focus({ preventScroll: true });
  }
}
