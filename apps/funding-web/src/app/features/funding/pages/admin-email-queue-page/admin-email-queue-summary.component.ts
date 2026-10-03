import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminEmailQueueResponse } from '@openg7/funding-core';

/** Admin summary: presents the server snapshot, independently of list filters. */
@Component({
  selector: 'openg7-admin-email-queue-summary',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-email-queue-summary.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-email-queue-summary.component.css'
  ]
})
export class AdminEmailQueueSummaryComponent {
  readonly summary = input.required<AdminEmailQueueResponse['summary']>();
  readonly updatedAtLabel = input.required<string>();
}
