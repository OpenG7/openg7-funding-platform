import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import type {
  AdminAttentionItemType,
  AdminAttentionSeverity,
  AdminWorkQueueQuery,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { AdminAssistantLabels } from './admin-assistant-labels.js';
import {
  ASSISTANT_TYPES,
  ASSISTANT_PRIORITIES,
  type AssistantEmailGroupFilter
} from './admin-assistant.contracts.js';

/** Local presentation surface; the routed page owns HTTP and navigation. */
@Component({
  selector: 'openg7-admin-assistant-filters',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-assistant-filters.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-assistant-surface.css',
    './admin-assistant-filters.component.css'
  ]
})
export class AdminAssistantFiltersComponent {
  readonly data = input.required<AdminWorkQueueResponse>();
  readonly query = input.required<AdminWorkQueueQuery>();
  readonly surface = input<'categories' | 'queue'>('queue');
  readonly priorities = ASSISTANT_PRIORITIES;
  readonly categories = computed(() =>
    ASSISTANT_TYPES.filter(
      (type) =>
        (this.data().typeCounts[type] ?? 0) > 0 || this.query().type === type
    )
  );
  readonly labels = new AdminAssistantLabels(inject(FundingI18nService));
  readonly typeChanged = output<AdminAttentionItemType | null>();
  readonly priorityChanged = output<AdminAttentionSeverity | null>();
  readonly emailGroupChanged = output<AssistantEmailGroupFilter>();
  changePriority(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.priorityChanged.emit(
      ASSISTANT_PRIORITIES.find((priority) => priority === value) ?? null
    );
  }
}
