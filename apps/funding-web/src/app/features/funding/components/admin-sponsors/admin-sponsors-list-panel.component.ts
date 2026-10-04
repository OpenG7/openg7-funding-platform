import { TranslatePipe } from '@ngx-translate/core';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  viewChild,
  input,
  output
} from '@angular/core';

import type {
  AdminSponsorFeedStatusOption,
  AdminSponsorListRow,
  AdminSponsorsListState,
  SponsorFeedStatusFilter,
  SponsorPaymentStatusFilter,
  SponsorshipReviewFilter
} from '../../models/admin-sponsors-ui.models.js';

import { AdminSponsorsFiltersComponent } from './list-filters/admin-sponsors-filters.component.js';
import { AdminSponsorsResultsComponent } from './list-results/admin-sponsors-results.component.js';
import { AdminSponsorsPaginationComponent } from './list-results/admin-sponsors-pagination.component.js';

@Component({
  selector: 'openg7-admin-sponsors-list-panel',
  standalone: true,
  imports: [
    TranslatePipe,
    AdminSponsorsFiltersComponent,
    AdminSponsorsResultsComponent,
    AdminSponsorsPaginationComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="sponsors-list-panel"
      #list
      data-og7="sponsors-list"
      [class.compact]="compact()"
      [attr.aria-label]="'admin.legacy.liste_des_commandites' | translate"
    >
      @if (compact()) {
        <div class="list-caption">
          <strong>{{ 'admin.dossier.workspace.queue' | translate }}</strong
          ><span>{{ totalItems() }}</span>
        </div>
      }
      <openg7-admin-sponsors-filters
        [compact]="compact()"
        [search]="search()"
        [reviewFilter]="reviewFilter()"
        [feedFilter]="feedFilter()"
        [paymentFilter]="paymentFilter()"
        [hasActiveFilters]="hasActiveFilters()"
        [feedStatusOptions]="feedStatusOptions()"
        (searchChange)="searchChange.emit($event)"
        (reviewFilterChange)="reviewFilterChange.emit($event)"
        (feedFilterChange)="feedFilterChange.emit($event)"
        (paymentFilterChange)="paymentFilterChange.emit($event)"
        (resetFilters)="resetFilters.emit()"
      />
      <openg7-admin-sponsors-results
        [compact]="compact()"
        [state]="state()"
        [rows]="rows()"
        [sponsorshipCount]="sponsorshipCount()"
        [hasActiveFilters]="hasActiveFilters()"
        [selectedSponsorshipId]="selectedSponsorshipId()"
        [selectionPulseId]="selectionPulseId()"
        (refresh)="refresh.emit()"
        (resetFilters)="resetFilters.emit()"
        (selectSponsorship)="selectSponsorship.emit($event)"
      />
      @if (state() !== 'loading' && state() !== 'error' && rows().length > 0) {
        <openg7-admin-sponsors-pagination
          [compact]="compact()"
          [paginationStart]="paginationStart()"
          [paginationEnd]="paginationEnd()"
          [totalItems]="totalItems()"
          [page]="page()"
          [totalPages]="totalPages()"
          [pageSize]="pageSize()"
          [pageSizeOptions]="pageSizeOptions()"
          (previousPage)="previousPage.emit()"
          (nextPage)="nextPage.emit()"
          (pageSizeChange)="pageSizeChange.emit($event)"
        />
      }
    </section>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    './admin-sponsors-list-workspace.css'
  ]
})
export class AdminSponsorsListPanelComponent {
  readonly compact = input(false);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  focusRow(id: string | null): void {
    const root = this.list()?.nativeElement;
    const row = [
      ...(root?.querySelectorAll<HTMLElement>('[data-og7="sponsor-row"]') ?? [])
    ].find((item) => item.dataset['og7Id'] === id);
    (
      row ?? root?.querySelector<HTMLInputElement>('input[type="search"]')
    )?.focus({ preventScroll: true });
  }

  readonly state = input.required<AdminSponsorsListState>();
  readonly rows = input.required<readonly AdminSponsorListRow[]>();
  readonly sponsorshipCount = input.required<number>();
  readonly hasActiveFilters = input.required<boolean>();
  readonly selectedSponsorshipId = input.required<string | null>();
  readonly selectionPulseId = input.required<string | null>();
  readonly search = input.required<string>();
  readonly reviewFilter = input.required<SponsorshipReviewFilter>();
  readonly feedFilter = input.required<SponsorFeedStatusFilter>();
  readonly paymentFilter = input.required<SponsorPaymentStatusFilter>();
  readonly feedStatusOptions =
    input.required<readonly AdminSponsorFeedStatusOption[]>();
  readonly pageSizeOptions = input.required<readonly number[]>();
  readonly paginationStart = input.required<number>();
  readonly paginationEnd = input.required<number>();
  readonly totalItems = input.required<number>();
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly pageSize = input.required<number>();

  readonly refresh = output<void>();
  readonly searchChange = output<string>();
  readonly reviewFilterChange = output<string>();
  readonly feedFilterChange = output<string>();
  readonly paymentFilterChange = output<string>();
  readonly resetFilters = output<void>();
  readonly selectSponsorship = output<string>();
  readonly previousPage = output<void>();
  readonly nextPage = output<void>();
  readonly pageSizeChange = output<number>();
}
