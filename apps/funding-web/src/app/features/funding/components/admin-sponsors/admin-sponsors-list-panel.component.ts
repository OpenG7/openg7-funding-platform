import { TranslatePipe } from '@ngx-translate/core';
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
  imports: [TranslatePipe, CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="sponsors-list-panel"
      [attr.aria-label]="'admin.legacy.liste_des_commandites' | translate"
    >
      <header class="admin-table-toolbar">
        <label class="search-control">
          {{ 'admin.legacy.recherche' | translate
          }}<input
            type="search"
            [attr.placeholder]="
              'admin.legacy.rechercher_une_entreprise_ou_un_courriel'
                | translate
            "
            [value]="search()"
            (input)="onSearch($event)"
          />
        </label>

        <div class="filter-row">
          <label>
            {{ 'admin.legacy.statut_de_revue' | translate
            }}<select
              [value]="reviewFilter()"
              (change)="onReviewFilterChange($event)"
            >
              <option value="all">{{ 'admin.legacy.tous' | translate }}</option>
              <option value="pending_review">
                {{ 'admin.legacy.en_attente' | translate }}
              </option>
              <option value="approved">
                {{ 'admin.legacy.approuvees' | translate }}
              </option>
              <option value="rejected">
                {{ 'admin.legacy.refusees' | translate }}
              </option>
            </select>
          </label>

          <label>
            {{ 'admin.legacy.visibilite_statut_feed' | translate
            }}<select
              [value]="feedFilter()"
              (change)="onFeedFilterChange($event)"
            >
              <option value="all">{{ 'admin.legacy.tous' | translate }}</option>
              <option
                *ngFor="let status of feedStatusOptions()"
                [value]="status.value"
              >
                {{ status.label }}
              </option>
            </select>
          </label>

          <label>
            {{ 'admin.legacy.paiement' | translate
            }}<select
              [value]="paymentFilter()"
              (change)="onPaymentFilterChange($event)"
            >
              <option value="all">{{ 'admin.legacy.tous' | translate }}</option>
              <option value="paid">
                {{ 'admin.legacy.paye' | translate }}
              </option>
              <option value="refunded">
                {{ 'admin.legacy.rembourse' | translate }}
              </option>
              <option value="disputed">
                {{ 'admin.legacy.litige' | translate }}
              </option>
            </select>
          </label>

          <button
            type="button"
            class="tertiary-action"
            (click)="resetFilters.emit()"
            [disabled]="!hasActiveFilters()"
          >
            {{ 'admin.legacy.reinitialiser' | translate }}
          </button>
        </div>
      </header>

      <div
        class="state state-loading"
        *ngIf="state() === 'loading'"
        aria-live="polite"
      >
        <span>{{ 'admin.legacy.chargement_des_commandites' | translate }}</span>
        <div class="skeleton-list" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      </div>

      <div class="state state-error" *ngIf="state() === 'error'">
        <strong>{{
          'admin.legacy.impossible_de_charger_les_commandites' | translate
        }}</strong>
        <span>{{
          'admin.legacy.les_donnees_n_ont_pas_pu_etre_recuperees' | translate
        }}</span>
        <button type="button" class="secondary-action" (click)="refresh.emit()">
          {{ 'admin.legacy.reessayer' | translate }}
        </button>
      </div>

      <ng-container *ngIf="state() !== 'loading' && state() !== 'error'">
        <div class="sponsor-table" *ngIf="rows().length > 0">
          <div class="sponsor-table-head" aria-hidden="true">
            <span>{{ 'admin.legacy.commanditaire' | translate }}</span
            ><span>{{ 'admin.legacy.commandite' | translate }}</span
            ><span>{{ 'admin.legacy.revue' | translate }}</span
            ><span>{{ 'admin.legacy.publication' | translate }}</span
            ><span>{{ 'admin.legacy.paiement' | translate }}</span
            ><span>{{ 'admin.legacy.soumission' | translate }}</span
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
              <small>{{ 'admin.legacy.soumis_le' | translate }}</small>
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
          <h2>
            {{
              'admin.legacy.toutes_les_commandites_ont_ete_revisees' | translate
            }}
          </h2>
          <p>
            {{
              'admin.legacy.il_n_y_a_actuellement_aucune_nouvelle_commandite_a_traiter'
                | translate
            }}
          </p>
        </article>

        <article
          class="empty-admin-state"
          *ngIf="
            state() === 'ready' &&
            sponsorshipCount() === 0 &&
            hasActiveFilters()
          "
        >
          <h2>
            {{
              'admin.legacy.aucune_commandite_ne_correspond_aux_filtres'
                | translate
            }}
          </h2>
          <p>
            {{
              'admin.legacy.reinitialisez_les_filtres_ou_elargissez_la_recherche'
                | translate
            }}
          </p>
          <button
            type="button"
            class="secondary-action"
            (click)="resetFilters.emit()"
          >
            {{ 'admin.legacy.reinitialiser_les_filtres' | translate }}
          </button>
        </article>

        <footer class="pagination-bar" *ngIf="rows().length > 0">
          <span>
            {{
              'admin.legacy.affichage_de_p0_a_p1_sur_p2_resultats'
                | translate
                  : {
                      p0: paginationStart(),
                      p1: paginationEnd(),
                      p2: totalItems()
                    }
            }}</span
          >
          <div class="pagination-controls">
            <button
              type="button"
              class="icon-action"
              (click)="previousPage.emit()"
              [disabled]="page() <= 1"
              [attr.aria-label]="'admin.legacy.page_precedente' | translate"
            >
              &lsaquo;
            </button>
            <strong>{{ page() }}</strong>
            <button
              type="button"
              class="icon-action"
              (click)="nextPage.emit()"
              [disabled]="page() >= totalPages()"
              [attr.aria-label]="'admin.legacy.page_suivante' | translate"
            >
              &rsaquo;
            </button>
          </div>
          <label>
            <span>{{ 'admin.legacy.par_page' | translate }}</span>
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
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css'
  ],
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      .sponsors-list-panel,
      .empty-admin-state {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.5rem;
      }

      .sponsors-list-panel {
        min-width: 0;
        overflow: hidden;
      }

      .admin-table-toolbar {
        align-items: end;
        border-bottom: 1px solid var(--admin-border);
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
        border: 1px solid var(--admin-border);
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
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
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
        color: var(--admin-muted);
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .state-error {
        background: var(--admin-panel);
        color: var(--admin-danger);
      }

      .state-loading {
        color: var(--admin-muted);
      }

      .skeleton-list {
        display: grid;
        gap: 0.65rem;
      }

      .skeleton-list span {
        background: linear-gradient(
          90deg,
          var(--admin-panel-raised),
          var(--admin-panel),
          var(--admin-panel-raised)
        );
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
        border-bottom: 1px solid var(--admin-border);
        color: var(--admin-muted);
        font-size: 0.76rem;
        font-weight: 900;
      }

      .sponsor-table-row {
        appearance: none;
        background: var(--sponsor-row-bg, var(--admin-panel));
        border: 0;
        border-bottom: 1px solid var(--admin-border);
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
        background: var(--sponsor-row-hover-bg, var(--admin-panel));
      }

      .sponsor-table-row.selected {
        background: var(--sponsor-row-selected-bg, var(--admin-panel));
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
        background: var(--admin-panel-raised);
        border-radius: 999px;
        color: var(--admin-text);
        display: inline-flex;
        font-weight: 900;
        height: 2.35rem;
        justify-content: center;
        width: 2.35rem;
      }

      .row-open {
        color: var(--admin-muted);
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
        color: var(--admin-muted);
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
        background: #3c3221;
        color: var(--admin-warning);
      }

      .status-approved,
      .feed-published,
      .payment-paid,
      .refund-completed,
      .visibility-visible {
        background: #193d32;
        color: var(--admin-success);
      }

      .status-rejected,
      .payment-failed,
      .refund-failed {
        background: #422532;
        color: var(--admin-danger);
      }

      .visibility-hidden,
      .feed-not_planned,
      .refund-not-requested {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .refund-processing {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .feed-drafted {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .tier-silver {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .tier-bronze {
        background: #3c3221;
        color: var(--admin-warning);
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
