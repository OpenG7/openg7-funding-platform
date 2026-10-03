import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import type {
  ContributionTypeFilter,
  PublicDisplayFilter
} from './admin-contributions-view.js';

@Component({
  selector: 'openg7-admin-contributions-filters',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-contributions-filters.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-contributions-filters.component.css'
  ]
})
export class AdminContributionsFiltersComponent {
  readonly search = input.required<string>();
  readonly typeFilter = input.required<ContributionTypeFilter>();
  readonly statusFilter = input.required<string>();
  readonly publicFilter = input.required<PublicDisplayFilter>();
  readonly searchChanged = output<string>();
  readonly typeChanged = output<ContributionTypeFilter>();
  readonly statusChanged = output<string>();
  readonly publicChanged = output<PublicDisplayFilter>();

  changeType(event: Event): void {
    const value = this.valueFromEvent(event);
    this.typeChanged.emit(
      value === 'personal_support' || value === 'sponsorship_interest'
        ? value
        : 'all'
    );
  }

  changePublic(event: Event): void {
    const value = this.valueFromEvent(event);
    this.publicChanged.emit(
      value === 'public' || value === 'private' ? value : 'all'
    );
  }

  valueFromEvent(event: Event): string {
    return (
      (event.target as HTMLInputElement | HTMLSelectElement | null)?.value ?? ''
    );
  }
}
