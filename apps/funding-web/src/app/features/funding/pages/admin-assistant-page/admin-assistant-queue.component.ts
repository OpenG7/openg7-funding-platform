import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminAttentionItem,
  AdminAttentionItemType,
  AdminAttentionSeverity,
  AdminWorkQueueQuery,
  AdminWorkQueueResponse
} from '@openg7/funding-core';
import { RouterLink } from '@angular/router';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { AdminAssistantLabels } from './admin-assistant-labels.js';
import {
  type AssistantEmailGroupFilter,
  type AssistantLoadState
} from './admin-assistant.contracts.js';
import { AdminAssistantFiltersComponent } from './admin-assistant-filters.component.js';
import { AdminAssistantPaginationComponent } from './admin-assistant-pagination.component.js';

/** Local presentation surface; the routed page owns HTTP and navigation. */
@Component({
  selector: 'openg7-admin-assistant-queue',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    AdminAssistantFiltersComponent,
    AdminAssistantPaginationComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-assistant-queue.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-assistant-surface.css',
    './admin-assistant-queue.component.css'
  ]
})
export class AdminAssistantQueueComponent {
  readonly data = input.required<AdminWorkQueueResponse>();
  readonly query = input.required<AdminWorkQueueQuery>();
  readonly state = input.required<AssistantLoadState>();
  readonly pages = computed(() =>
    Math.max(1, Math.ceil(this.data().filteredTotal / this.data().pageSize))
  );
  readonly labels = new AdminAssistantLabels(inject(FundingI18nService));
  readonly typeChanged = output<AdminAttentionItemType | null>();
  readonly priorityChanged = output<AdminAttentionSeverity | null>();
  readonly emailGroupChanged = output<AssistantEmailGroupFilter>();
  readonly itemOpened = output<AdminAttentionItem>();
  readonly pageChanged = output<number>();
}
