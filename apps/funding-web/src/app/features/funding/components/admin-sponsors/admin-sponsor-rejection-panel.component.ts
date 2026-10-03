import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminSponsorRejectionFieldChange } from '../../models/admin-sponsor-dossier-panels.js';
import type { SponsorRejectionDraft } from '../../models/admin-sponsor-workflow.ports.js';

/** Funding organism: refusal presentation; the page keeps the draft and commands. */
@Component({
  selector: 'openg7-admin-sponsor-rejection-panel',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-rejection-panel.component.html',
  styleUrls: [
    '../admin-ui/admin-forms.css',
    './admin-sponsor-rejection-panel.component.css'
  ]
})
export class AdminSponsorRejectionPanelComponent {
  readonly draft = input.required<SponsorRejectionDraft>();
  readonly reviewNote = input.required<string>();
  readonly validationMessage = input.required<string>();
  readonly canConfirm = input.required<boolean>();
  readonly actionsDisabled = input.required<boolean>();
  readonly actionPending = input.required<boolean>();
  readonly busy = input.required<boolean>();

  readonly reviewNoteChange = output<Event>();
  readonly draftFieldChange = output<AdminSponsorRejectionFieldChange>();
  readonly notifySponsorChange = output<Event>();
  readonly refundHandlingChange = output<Event>();
  readonly cancelled = output<void>();
  readonly confirmed = output<void>();

  private readonly rejectionReason =
    viewChild<ElementRef<HTMLTextAreaElement>>('rejectionReason');

  focusReason(): void {
    this.rejectionReason()?.nativeElement.focus();
  }
}
