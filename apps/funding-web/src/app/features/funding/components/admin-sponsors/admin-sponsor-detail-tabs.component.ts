import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { SponsorDetailsTab } from '../../models/admin-sponsors-ui.models.js';

interface AdminSponsorDetailTabItem {
  readonly id: SponsorDetailsTab;
  readonly label: string;
}

@Component({
  selector: 'openg7-admin-sponsor-detail-tabs',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="detail-tabs" aria-label="Onglets du dossier">
      <button
        *ngFor="let tab of tabs"
        type="button"
        [class.active]="activeTab() === tab.id"
        [attr.aria-current]="activeTab() === tab.id ? 'page' : null"
        (click)="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .detail-tabs {
        border-bottom: 1px solid #e4e9f2;
        border-top: 1px solid #e4e9f2;
        display: flex;
        gap: 0.25rem;
        overflow-x: auto;
        padding: 0 1rem;
      }

      .detail-tabs button {
        background: transparent;
        border: 0;
        border-bottom: 0.18rem solid transparent;
        color: #38425a;
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
        border-color: #2563eb;
        color: #0f3e99;
      }
    `
  ]
})
export class AdminSponsorDetailTabsComponent {
  readonly activeTab = input.required<SponsorDetailsTab>();
  readonly activeTabChange = output<SponsorDetailsTab>();

  readonly tabs: readonly AdminSponsorDetailTabItem[] = [
    { id: 'overview', label: "Vue d'ensemble" },
    { id: 'identity', label: 'Identite & logo' },
    { id: 'publication', label: 'Publication' },
    { id: 'refund', label: 'Remboursements' },
    { id: 'audit', label: 'Historique & audit' }
  ];

  selectTab(tab: SponsorDetailsTab): void {
    this.activeTabChange.emit(tab);
  }
}
