import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { SponsorDetailsTab } from '../../models/admin-sponsors-ui.models.js';

interface AdminSponsorDetailTabItem {
  readonly id: SponsorDetailsTab;
  readonly label: string;
}

@Component({
  selector: 'openg7-admin-sponsor-detail-tabs',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav
      class="detail-tabs"
      [attr.aria-label]="'admin.dossier.tabsLabel' | translate"
      data-og7="dossier-tabs"
    >
      <button
        *ngFor="let tab of tabs"
        type="button"
        [class.active]="isActive(tab.id)"
        [attr.aria-current]="isActive(tab.id) ? 'page' : null"
        (click)="selectTab(tab.id)"
      >
        {{ 'admin.dossier.workspace.' + tab.label | translate }}
      </button>
    </nav>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-detail-tabs.component.css'
  ]
})
export class AdminSponsorDetailTabsComponent {
  readonly activeTab = input.required<SponsorDetailsTab>();
  readonly activeTabChange = output<SponsorDetailsTab>();

  readonly tabs: readonly AdminSponsorDetailTabItem[] = [
    { id: 'overview', label: 'overview' },
    { id: 'identity', label: 'profile' },
    { id: 'publication', label: 'publication' },
    { id: 'billing', label: 'finances' },
    { id: 'audit', label: 'history' }
  ];

  isActive(tab: SponsorDetailsTab): boolean {
    const active = this.activeTab();
    return (
      tab === active ||
      (tab === 'identity' && active === 'media') ||
      (tab === 'billing' && active === 'refund')
    );
  }

  selectTab(tab: SponsorDetailsTab): void {
    this.activeTabChange.emit(tab);
  }
}
