import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type {
  AdminSponsorFeedStatusOption,
  SponsorFeedStatusFilter,
  SponsorPaymentStatusFilter,
  SponsorshipReviewFilter
} from '../../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsors-filters',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': 'compact()' },
  templateUrl: './admin-sponsors-filters.component.html',
  styleUrls: [
    '../../admin-ui/admin-theme.css',
    '../../admin-ui/admin-controls.css',
    '../../admin-ui/admin-forms.css',
    './admin-sponsors-filters.component.css'
  ]
})
export class AdminSponsorsFiltersComponent {
  readonly compact = input(false);
  readonly search = input.required<string>();
  readonly reviewFilter = input.required<SponsorshipReviewFilter>();
  readonly feedFilter = input.required<SponsorFeedStatusFilter>();
  readonly paymentFilter = input.required<SponsorPaymentStatusFilter>();
  readonly hasActiveFilters = input.required<boolean>();
  readonly feedStatusOptions =
    input.required<readonly AdminSponsorFeedStatusOption[]>();

  readonly searchChange = output<string>();
  readonly reviewFilterChange = output<string>();
  readonly feedFilterChange = output<string>();
  readonly paymentFilterChange = output<string>();
  readonly resetFilters = output<void>();

  onSearch(event: Event): void {
    this.searchChange.emit(this.valueFromEvent(event));
  }

  onReviewFilterChange(event: Event): void {
    this.reviewFilterChange.emit(this.valueFromEvent(event));
  }

  onFeedFilterChange(event: Event): void {
    this.feedFilterChange.emit(this.valueFromEvent(event));
  }

  onPaymentFilterChange(event: Event): void {
    this.paymentFilterChange.emit(this.valueFromEvent(event));
  }

  private valueFromEvent(event: Event): string {
    return (
      (event.target as HTMLInputElement | HTMLSelectElement | null)?.value ?? ''
    );
  }
}
