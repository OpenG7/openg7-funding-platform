import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type {
  OverviewDestination,
  SponsorOverviewView
} from '../../models/admin-sponsor-overview.projection.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';
import { AdminBadgeComponent } from '../admin-ui/admin-badge.component.js';

interface OverviewStat {
  readonly id: string;
  readonly icon: AdminIconName;
  readonly value: string | number | null;
  readonly valueKey?: string;
  readonly ratio?: { readonly done: number; readonly total: number } | null;
  readonly tone?: string;
  readonly destination: OverviewDestination | null;
}

/** Read-only dashboard; destinations retain their existing business workflows. */
@Component({
  selector: 'openg7-admin-sponsor-detail-overview',
  standalone: true,
  imports: [TranslatePipe, AdminIconComponent, AdminBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-detail-overview.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-sponsor-detail-overview.component.css'
  ]
})
export class AdminSponsorDetailOverviewComponent {
  readonly view = input.required<SponsorOverviewView>();
  readonly navigate = output<OverviewDestination>();
  readonly stats = computed<readonly OverviewStat[]>(() => {
    const stats = this.view().stats;
    const ratio = (value: { done: number; total: number } | null) =>
      value ? `${value.done}/${value.total}` : null;
    return [
      {
        id: 'steps',
        icon: 'check',
        value: ratio(stats.steps),
        ratio: stats.steps,
        destination: { kind: 'tab', tab: 'publication', section: 'agreement' }
      },
      {
        id: 'services',
        icon: 'publications',
        value: ratio(stats.services),
        ratio: stats.services,
        destination: { kind: 'tab', tab: 'publication' }
      },
      {
        id: 'blockers',
        icon: 'warning',
        value: stats.blockers,
        tone: stats.blockers ? 'danger' : 'neutral',
        destination: { kind: 'tab', tab: 'publication' }
      },
      {
        id: 'visibility',
        icon: 'globe',
        value: null,
        valueKey:
          'admin.dossier.overviewDashboard.visibility.' + stats.visibility,
        destination: { kind: 'tab', tab: 'media', section: 'website-settings' }
      },
      {
        id: 'media',
        icon: 'image',
        value: ratio(stats.media),
        ratio: stats.media,
        destination: { kind: 'tab', tab: 'media' }
      },
      {
        id: 'proposals',
        icon: 'transparency',
        value: stats.proposals,
        tone: 'success',
        destination: null
      }
    ];
  });
  domainIcon(id: string): AdminIconName {
    return id === 'identity'
      ? 'person'
      : id === 'media'
        ? 'image'
        : id === 'review'
          ? 'audit'
          : id === 'finance'
            ? 'invoices'
            : 'publications';
  }
}
