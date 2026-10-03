import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { normalizeEmailQueueStatusFilter } from './admin-email-queue-presentation.js';
import type { EmailQueueStatusFilter } from './admin-email-queue-presentation.js';

/** Admin filters: emits typed changes while the page owns their state. */
@Component({
  selector: 'openg7-admin-email-queue-filters',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-email-queue-filters.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-email-queue-filters.component.css'
  ]
})
export class AdminEmailQueueFiltersComponent {
  readonly status = input.required<EmailQueueStatusFilter>();
  readonly search = input.required<string>();
  readonly statusChange = output<EmailQueueStatusFilter>();
  readonly searchChange = output<string>();

  changeStatus(event: Event): void {
    this.statusChange.emit(
      normalizeEmailQueueStatusFilter(
        (event.target as HTMLSelectElement | null)?.value ?? 'all'
      )
    );
  }

  changeSearch(event: Event): void {
    this.searchChange.emit(
      (event.target as HTMLInputElement | null)?.value ?? ''
    );
  }
}
