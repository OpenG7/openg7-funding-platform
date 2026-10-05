import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminEmailQueueMessageRecord } from '@openg7/funding-core';

import type {
  EmailQueueLoadState,
  EmailQueueMessageView
} from './admin-email-queue-presentation.js';

/** Admin list: renders page-owned message results and emits user intentions. */
@Component({
  selector: 'openg7-admin-email-queue-messages',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-email-queue-messages.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-email-queue-messages.component.css'
  ]
})
export class AdminEmailQueueMessagesComponent {
  readonly messages = input.required<readonly EmailQueueMessageView[]>();
  readonly state = input.required<EmailQueueLoadState>();
  readonly lastFailedAtLabel = input.required<string>();
  readonly inspectRequested = output<AdminEmailQueueMessageRecord>();
  readonly retryRequested = output<AdminEmailQueueMessageRecord>();

  readonly reconcileRequested = output<{
    message: AdminEmailQueueMessageRecord;
    outcome: 'sent' | 'not_sent';
    evidenceReference: string;
  }>();

  trackByMessage(_index: number, view: EmailQueueMessageView): string {
    return view.message.id;
  }
}
