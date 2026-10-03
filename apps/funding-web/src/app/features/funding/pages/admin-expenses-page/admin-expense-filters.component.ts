import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminExpenseStatus } from '@openg7/funding-core';

import {
  expenseStatuses,
  expenseStatusTranslationKeys
} from './admin-expense-presentation.types.js';
import type { ExpenseStatusFilter } from './admin-expense-presentation.types.js';

/** Admin molecule: controls for page-owned allocation filters. */
@Component({
  selector: 'openg7-admin-expense-filters',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="filters"
      data-og7="allocation-filters"
      [attr.aria-label]="'admin.legacy.filtres_depenses' | translate"
    >
      <label>
        {{ 'admin.legacy.recherche' | translate
        }}<input
          type="search"
          [attr.placeholder]="
            'admin.legacy.projet_fournisseur_description' | translate
          "
          [value]="search()"
          (input)="changeSearch($event)"
        />
      </label>
      <label>
        {{ 'admin.legacy.statut' | translate
        }}<select [value]="status()" (change)="changeStatus($event)">
          <option value="all">{{ 'admin.legacy.tous' | translate }}</option>
          <option *ngFor="let value of expenseStatuses" [value]="value">
            {{ statusKeys[value] | translate }}
          </option>
        </select>
      </label>
    </section>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-expense-fields.css'
  ]
})
export class AdminExpenseFiltersComponent {
  readonly search = input.required<string>();
  readonly status = input.required<ExpenseStatusFilter>();
  readonly searchChange = output<string>();
  readonly statusChange = output<ExpenseStatusFilter>();
  readonly expenseStatuses = expenseStatuses;
  readonly statusKeys = expenseStatusTranslationKeys;

  changeSearch(event: Event): void {
    this.searchChange.emit(
      (event.target as HTMLInputElement | null)?.value ?? ''
    );
  }

  changeStatus(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? '';
    this.statusChange.emit(
      expenseStatuses.includes(value as AdminExpenseStatus)
        ? (value as AdminExpenseStatus)
        : 'all'
    );
  }
}
