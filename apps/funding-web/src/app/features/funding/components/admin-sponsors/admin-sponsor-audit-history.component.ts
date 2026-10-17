import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminSponsorAuditHistoryView } from '../../models/admin-sponsors-ui.models.js';
import type { SponsorHistoryDomain } from '../../models/admin-sponsor-workflow.ports.js';

/** Dossier audit presentation; inspection is delegated to the page. */
@Component({
  selector: 'openg7-admin-sponsor-audit-history',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-audit-history.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-history.css',
    './admin-sponsor-audit-history.component.css'
  ]
})
export class AdminSponsorAuditHistoryComponent {
  readonly view = input.required<AdminSponsorAuditHistoryView>();
  readonly inspect = output<void>();
  readonly domains: readonly SponsorHistoryDomain[] = [
    'profile',
    'review',
    'publication',
    'finances',
    'followup',
    'other'
  ];
  readonly domainFilter = signal<SponsorHistoryDomain | 'all'>('all');
  readonly visibleEntries = computed(() => {
    const domain = this.domainFilter();
    return domain === 'all'
      ? this.view().entries
      : this.view().entries.filter(
          (entry) => (entry.domain ?? 'other') === domain
        );
  });

  setDomainFilter(value: string): void {
    if (value === 'all' || this.domains.includes(value as SponsorHistoryDomain))
      this.domainFilter.set(value as SponsorHistoryDomain | 'all');
  }
}
