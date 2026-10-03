import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminAssistantSummary } from '@openg7/funding-core';

import type { AssistantLoadState } from './admin-assistant.contracts.js';

/** Local presentation surface; the routed page owns HTTP and navigation. */
@Component({
  selector: 'openg7-admin-assistant-summary',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-assistant-summary.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-assistant-surface.css',
    './admin-assistant-summary.component.css'
  ]
})
export class AdminAssistantSummaryComponent {
  readonly summaryState = input.required<AssistantLoadState>();
  readonly summary = input.required<AdminAssistantSummary | null>();
  readonly generatedAtLabel = input.required<string>();
  readonly opened = output<boolean>();
  toggle(event: Event): void {
    this.opened.emit((event.target as HTMLDetailsElement).open);
  }
}
