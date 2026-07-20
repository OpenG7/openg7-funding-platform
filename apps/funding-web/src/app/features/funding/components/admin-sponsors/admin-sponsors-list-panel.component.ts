import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
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

@Component({
  selector: 'openg7-admin-sponsors-list-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sponsors-list-panel" aria-label="Liste des commandites">
      <header class="admin-table-toolbar">
        <label class="search-control">
          Recherche
          <input
            type="search"
            placeholder="Rechercher une entreprise ou un courriel..."
            [value]="search()"
            (input)="onSearch($event)"
          />
        </label>

        <div class="filter-row">
          <label>
            Statut de revue
            <select
              [value]="reviewFilter()"
              (change)="onReviewFilterChange($event)"
            >
              <option value="all">Tous</option>
              <option value="pending_review">En attente</option>
              <option value="approved">Approuvees</option>
              <option value="rejected">Refusees</option>
            </select>
          </label>

          <label>
            Visibilite / statut feed
            <select
              [value]="feedFilter()"
              (change)="onFeedFilterChange($event)"
            >
              <option value="all">Tous</option>
              <option
                *ngFor="let status of feedStatusOptions()"
                [value]="status.value"
              >
                {{ status.label }}
              </option>
            </select>
          </label>

          <label>
            Paiement
            <select
              [value]="paymentFilter()"
              (change)="onPaymentFilterChange($event)"
            >
              <option value="all">Tous</option>
              <option value="paid">Paye</option>
              <option value="refunded">Rembourse</option>
              <option value="disputed">Litige</option>
            </select>
          </label>

          <button
            type="button"
            class="tertiary-action"
            (click)="resetFilters.emit()"
            [disabled]="!hasActiveFilters()"
          >
            Reinitialiser
          </button>
        </div>
      </header>

      <div
        class="state state-loading"
        *ngIf="state() === 'loading'"
        aria-live="polite"
      >
        <span>Chargement des commandites...</span>
        <div class="skeleton-list" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      </div>

      <div class="state state-error" *ngIf="state() === 'error'">
        <strong>Impossible de charger les commandites.</strong>
        <span>Les donnees n'ont pas pu etre recuperees.</span>
        <button type="button" class="secondary-action" (click)="refresh.emit()">
          Reessayer
        </button>
      </div>

      <ng-container *ngIf="state() !== 'loading' && state() !== 'error'">
        <div class="sponsor-table" *ngIf="rows().length > 0">
          <div class="sponsor-table-head" aria-hidden="true">
            <span>Commanditaire</span><span>Commandite</span><span>Revue</span
            ><span>Publication</span><span>Paiement</span><span>Soumission</span
            ><span></span>
          </div>

          <button
            type="button"
            class="sponsor-table-row"
            [ngClass]="row.rowStateClass"
            [attr.title]="row.processingLabel"
            [class.selection-pulse]="selectionPulseId() === row.id"
            *ngFor="let row of rows(); trackBy: trackByRowId"
            [class.selected]="selectedSponsorshipId() === row.id"
            [attr.aria-current]="
              selectedSponsorshipId() === row.id ? 'true' : null
            "
            (click)="selectSponsorship.emit(row.id)"
          >
            <span class="row-cell sponsor-main">
              <span class="sponsor-avatar" aria-hidden="true">{{
                row.initials
              }}</span>
              <span>
                <strong>{{ row.companyName }}</strong>
                <small>{{ row.contactEmail }}</small>
              </span>
            </span>
            <span class="row-cell amount-cell">
              <strong>{{ row.amountLabel }}</strong>
              <small [class]="row.tierClass">{{ row.tierLabel }}</small>
            </span>
            <span class="row-cell stacked-cell">
              <span [class]="row.reviewStatusClass">{{
                row.reviewStatusLabel
              }}</span>
              <span [class]="row.visibilityClass">{{
                row.visibilityLabel
              }}</span>
            </span>
            <span class="row-cell stacked-cell">
              <span [class]="row.feedStatusClass">{{
                row.feedStatusLabel
              }}</span>
              <small>{{ row.feedTargetLabel }}</small>
              <small>{{ row.feedChannelsLabel }}</small>
            </span>
            <span class="row-cell stacked-cell">
              <span [class]="row.paymentStatusClass">{{
                row.paymentStatusLabel
              }}</span>
              <span
                *ngIf="row.refundWorkflowStatusClass"
                [class]="row.refundWorkflowStatusClass"
                >{{ row.refundWorkflowStatusLabel }}</span
              >
              <small>{{ row.paidAtLabel }}</small>
            </span>
            <span class="row-cell stacked-cell">
              <small>Soumis le</small>
              <span>{{ row.submittedAtLabel }}</span>
            </span>
            <span class="row-cell row-open" aria-hidden="true">&rsaquo;</span>
          </button>
        </div>

        <article
          class="empty-admin-state"
          *ngIf="
            state() === 'ready' &&
            sponsorshipCount() === 0 &&
            !hasActiveFilters()
          "
        >
          <h2>Toutes les commandites ont ete revisees.</h2>
          <p>Il n'y a actuellement aucune nouvelle commandite a traiter.</p>
        </article>

        <article
          class="empty-admin-state"
          *ngIf="
            state() === 'ready' &&
            sponsorshipCount() === 0 &&
            hasActiveFilters()
          "
        >
          <h2>Aucune commandite ne correspond aux filtres.</h2>
          <p>Reinitialisez les filtres ou elargissez la recherche.</p>
          <button
            type="button"
            class="secondary-action"
            (click)="resetFilters.emit()"
          >
            Reinitialiser les filtres
          </button>
        </article>

        <footer class="pagination-bar" *ngIf="rows().length > 0">
          <span>
            Affichage de {{ paginationStart() }} a {{ paginationEnd() }} sur
            {{ totalItems() }} resultats
          </span>
          <div class="pagination-controls">
            <button
              type="button"
              class="icon-action"
              (click)="previousPage.emit()"
              [disabled]="page() <= 1"
              aria-label="Page precedente"
            >
              &lsaquo;
            </button>
            <strong>{{ page() }}</strong>
            <button
              type="button"
              class="icon-action"
              (click)="nextPage.emit()"
              [disabled]="page() >= totalPages()"
              aria-label="Page suivante"
            >
              &rsaquo;
            </button>
          </div>
          <label>
            <span>Par page</span>
            <select [value]="pageSize()" (change)="onPageSizeChange($event)">
              <option *ngFor="let size of pageSizeOptions()" [value]="size">
                {{ size }}
              </option>
            </select>
          </label>
        </footer>
      </ng-container>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      .sponsors-list-panel,
      .empty-admin-state {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.5rem;
      }

      .sponsors-list-panel {
        min-width: 0;
        overflow: hidden;
      }

      .admin-table-toolbar {
        align-items: end;
        border-bottom: 1px solid #e4e9f2;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(16rem, 1fr) auto;
        padding: 1rem;
      }

      .filter-row,
      .pagination-controls {
        align-items: center;
        display: flex;
        gap: 0.75rem;
      }

      .filter-row {
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .search-control,
      .admin-table-toolbar label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.84rem;
        font-weight: 800;
      }

      button,
      input,
      select {
        font: inherit;
      }

      button:focus-visible,
      input:focus-visible,
      select:focus-visible {
        outline: 3px solid rgba(37, 99, 235, 0.28);
        outline-offset: 2px;
      }

      input,
      select {
        border: 1px solid #cdd6e3;
        border-radius: 0.35rem;
        padding: 0.65rem 0.75rem;
      }

      .secondary-action,
      .tertiary-action,
      .icon-action {
        align-items: center;
        border-radius: 0.4rem;
        cursor: pointer;
        display: inline-flex;
        font-weight: 900;
        justify-content: center;
        min-height: 2.5rem;
        padding: 0 0.85rem;
        text-decoration: none;
      }

      .secondary-action,
      .tertiary-action,
      .icon-action {
        background: #fff;
        border: 1px solid #cfd8e6;
        color: #172033;
      }

      .tertiary-action:disabled,
      .secondary-action:disabled,
      .icon-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .icon-action {
        min-height: 2.2rem;
        padding: 0;
        width: 2.2rem;
      }

      .state,
      .empty-admin-state {
        display: grid;
        gap: 0.7rem;
        padding: 1rem;
      }

      .empty-admin-state h2 {
        margin: 0;
      }

      .empty-admin-state p {
        color: #566274;
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .state-error {
        background: #fff7f8;
        color: #9f1d2f;
      }

      .state-loading {
        color: #38425a;
      }

      .skeleton-list {
        display: grid;
        gap: 0.65rem;
      }

      .skeleton-list span {
        background: linear-gradient(90deg, #edf2f7, #f8fafc, #edf2f7);
        border-radius: 0.35rem;
        display: block;
        height: 3.5rem;
      }

      .sponsor-table {
        display: grid;
      }

      .sponsor-table-head,
      .sponsor-table-row {
        display: grid;
        gap: 0.65rem;
        grid-template-columns:
          minmax(12rem, 1.6fr) minmax(6rem, 0.7fr) minmax(6.75rem, 0.75fr)
          minmax(7rem, 0.8fr) minmax(7rem, 0.75fr) minmax(7rem, 0.75fr)
          1.25rem;
        padding: 0.75rem 1rem;
      }

      .sponsor-table-head {
        border-bottom: 1px solid #e8edf5;
        color: #506079;
        font-size: 0.76rem;
        font-weight: 900;
      }

      .sponsor-table-row {
        appearance: none;
        background: var(--sponsor-row-bg, #fff);
        border: 0;
        border-bottom: 1px solid #edf1f6;
        border-left: 0.28rem solid var(--sponsor-row-accent, transparent);
        box-sizing: border-box;
        color: inherit;
        padding-left: 0.72rem;
        text-align: left;
        transition:
          background-color 0.16s ease,
          box-shadow 0.16s ease,
          border-color 0.16s ease;
        width: 100%;
      }

      .sponsor-table-row:hover {
        background: var(--sponsor-row-hover-bg, #f8fbff);
      }

      .sponsor-table-row.selected {
        background: var(--sponsor-row-selected-bg, #f8fbff);
        box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.24);
      }

      .sponsor-row-state-action-required {
        --sponsor-row-accent: #d8941f;
        --sponsor-row-bg: #fff8ea;
        --sponsor-row-hover-bg: #fff1d4;
        --sponsor-row-selected-bg: #fff4dc;
      }

      .sponsor-row-state-approved-ready {
        --sponsor-row-accent: #2f855a;
        --sponsor-row-bg: #f0fbf4;
        --sponsor-row-hover-bg: #e4f7eb;
        --sponsor-row-selected-bg: #e8f7ee;
      }

      .sponsor-row-state-publication-progress {
        --sponsor-row-accent: #3b73d9;
        --sponsor-row-bg: #eef5ff;
        --sponsor-row-hover-bg: #e4efff;
        --sponsor-row-selected-bg: #e8f1ff;
      }

      .sponsor-row-state-published {
        --sponsor-row-accent: #2aa198;
        --sponsor-row-bg: #ebfaf7;
        --sponsor-row-hover-bg: #ddf6f1;
        --sponsor-row-selected-bg: #e4f6f3;
      }

      .sponsor-row-state-blocked {
        --sponsor-row-accent: #c0392b;
        --sponsor-row-bg: #fff0ee;
        --sponsor-row-hover-bg: #ffe4e1;
        --sponsor-row-selected-bg: #fdecea;
      }

      .sponsor-row-state-waiting-payment {
        --sponsor-row-accent: #6f7a8e;
        --sponsor-row-bg: #f3f6fa;
        --sponsor-row-hover-bg: #edf1f7;
        --sponsor-row-selected-bg: #eef2f7;
      }

      .row-cell,
      .stacked-cell,
      .amount-cell {
        align-content: center;
        display: grid;
        gap: 0.3rem;
        min-width: 0;
      }

      .sponsor-main {
        align-items: center;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: auto minmax(0, 1fr);
      }

      .sponsor-main strong,
      .sponsor-main small,
      .stacked-cell small {
        overflow-wrap: anywhere;
      }

      .sponsor-avatar {
        align-items: center;
        background: #172033;
        border-radius: 999px;
        color: #fff;
        display: inline-flex;
        font-weight: 900;
        height: 2.35rem;
        justify-content: center;
        width: 2.35rem;
      }

      .row-open {
        color: #506079;
        font-size: 1.6rem;
        justify-content: center;
      }

      .pagination-bar {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        padding: 0.8rem 1rem;
      }

      .pagination-bar label {
        align-items: center;
        display: flex;
        gap: 0.45rem;
      }

      .sponsor-table-row small {
        color: #667085;
      }

      .status-badge,
      .visibility-badge,
      .feed-badge,
      .payment-badge,
      .refund-badge,
      .tier-badge {
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.72rem;
        font-weight: 900;
        padding: 0.25rem 0.55rem;
        width: max-content;
      }

      .status-pending,
      .feed-planned,
      .payment-pending,
      .refund-requested,
      .visibility-review,
      .tier-gold {
        background: #fff2cf;
        color: #8a5a00;
      }

      .status-approved,
      .feed-published,
      .payment-paid,
      .refund-completed,
      .visibility-visible {
        background: #dff7e8;
        color: #176236;
      }

      .status-rejected,
      .payment-failed,
      .refund-failed {
        background: #ffe0e5;
        color: #9f1d2f;
      }

      .visibility-hidden,
      .feed-not_planned,
      .refund-not-requested {
        background: #eef1f5;
        color: #667085;
      }

      .refund-processing {
        background: #e8f1ff;
        color: #174ea6;
      }

      .feed-drafted {
        background: #ede9fe;
        color: #5b21b6;
      }

      .tier-silver {
        background: #eef2f7;
        color: #38425a;
      }

      .tier-bronze {
        background: #fff0e5;
        color: #9a4d13;
      }

      @keyframes selected-box-fade-in {
        0% {
          box-shadow:
            inset 0.18rem 0 0 #2563eb,
            0 0 0 0 rgb(37 99 235 / 0%);
          opacity: 0.62;
          transform: translateY(0.25rem);
        }
        45% {
          box-shadow:
            inset 0.18rem 0 0 #2563eb,
            0 0 0 0.28rem rgb(37 99 235 / 14%);
          opacity: 1;
        }
        100% {
          box-shadow:
            inset 0.18rem 0 0 #2563eb,
            0 0 0 0 rgb(37 99 235 / 0%);
          opacity: 1;
          transform: translateY(0);
        }
      }

      .sponsor-table-row.selection-pulse {
        animation: selected-box-fade-in 0.52s ease both;
      }

      @media (max-width: 1120px) {
        .sponsor-table-head {
          display: none;
        }

        .sponsor-table-row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.8rem 1rem;
          padding: 1rem;
        }

        .sponsor-main {
          grid-column: 1 / -1;
        }

        .row-open {
          display: none;
        }
      }

      @media (max-width: 860px) {
        .admin-table-toolbar {
          grid-template-columns: 1fr;
        }

        .pagination-bar {
          align-items: stretch;
          flex-direction: column;
        }

        .sponsor-table-head {
          display: none;
        }

        .sponsor-table-row {
          grid-template-columns: 1fr;
          gap: 0.7rem;
        }

        .row-open {
          display: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .sponsor-table-row.selection-pulse {
          animation: none;
        }
      }
    `
  ]
})
export class AdminSponsorsListPanelComponent {
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

  onPageSizeChange(event: Event): void {
    const value = Number.parseInt(this.valueFromEvent(event), 10);
    if (Number.isFinite(value)) {
      this.pageSizeChange.emit(value);
    }
  }

  trackByRowId(_: number, row: AdminSponsorListRow): string {
    return row.id;
  }

  private valueFromEvent(event: Event): string {
    return (
      (event.target as HTMLInputElement | HTMLSelectElement | null)?.value ?? ''
    );
  }
}
