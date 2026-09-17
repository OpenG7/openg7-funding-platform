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
        [class.active]="activeTab() === tab.id"
        [attr.aria-current]="activeTab() === tab.id ? 'page' : null"
        (click)="selectTab(tab.id)"
      >
        {{ 'admin.dossier.tabs.' + tab.id | translate }}
      </button>
    </nav>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css'
  ],
  styles: [
    `
      :host {
        display: block;
      }

      .detail-tabs {
        border-bottom: 1px solid var(--admin-border);
        border-top: 1px solid var(--admin-border);
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        padding: 0 1rem;
      }

      .detail-tabs button {
        background: transparent;
        border: 0;
        border-bottom: 0.18rem solid transparent;
        color: var(--admin-muted);
        cursor: pointer;
        font: inherit;
        font-weight: 900;
        padding: 0.9rem 0.65rem 0.72rem;
        white-space: nowrap;
      }

      .detail-tabs button:focus-visible {
        outline: 3px solid rgba(37, 99, 235, 0.28);
        outline-offset: 2px;
      }

      .detail-tabs button.active {
        border-color: var(--admin-border);
        color: var(--admin-muted);
      }
    `
  ]
})
export class AdminSponsorDetailTabsComponent {
  readonly activeTab = input.required<SponsorDetailsTab>();
  readonly activeTabChange = output<SponsorDetailsTab>();

  readonly tabs: readonly AdminSponsorDetailTabItem[] = [
    { id: 'overview' },
    { id: 'identity' },
    { id: 'media' },
    { id: 'publication' },
    { id: 'billing' },
    { id: 'refund' },
    { id: 'audit' }
  ];

  selectTab(tab: SponsorDetailsTab): void {
    this.activeTabChange.emit(tab);
  }
}
