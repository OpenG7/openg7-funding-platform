import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type {
  AdminSponsorListRow,
  AdminSponsorsListState
} from '../../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsors-results',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': 'compact()' },
  templateUrl: './admin-sponsors-results.component.html',
  styleUrls: [
    '../../admin-ui/admin-theme.css',
    '../../admin-ui/admin-controls.css',
    '../../admin-ui/admin-forms.css',
    './admin-sponsors-results.component.css'
  ]
})
export class AdminSponsorsResultsComponent {
  readonly compact = input(false);
  readonly state = input.required<AdminSponsorsListState>();
  readonly rows = input.required<readonly AdminSponsorListRow[]>();
  readonly sponsorshipCount = input.required<number>();
  readonly hasActiveFilters = input.required<boolean>();
  readonly selectedSponsorshipId = input.required<string | null>();
  readonly selectionPulseId = input.required<string | null>();

  readonly refresh = output<void>();
  readonly resetFilters = output<void>();
  readonly selectSponsorship = output<string>();

  trackByRowId(_: number, row: AdminSponsorListRow): string {
    return row.id;
  }
}
