import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminExpenseFormFieldsComponent } from './admin-expense-form-fields.component.js';
import type {
  ExpenseEditFieldChange,
  NewExpenseDraft,
  NewExpenseFieldChange
} from './admin-expense-presentation.types.js';

/** Admin organism: creation surface; the page owns validation and submission. */
@Component({
  selector: 'openg7-admin-expense-create',
  standalone: true,
  imports: [TranslatePipe, AdminExpenseFormFieldsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="create-panel"
      data-og7="allocation-create"
      aria-labelledby="create-title"
    >
      <header>
        <div>
          <span>{{ 'admin.legacy.nouvelle_entree' | translate }}</span>
          <h2 id="create-title">
            {{ 'admin.legacy.ajouter_une_depense_ou_allocation' | translate }}
          </h2>
        </div>
      </header>

      <openg7-admin-expense-form-fields
        [draft]="draft()"
        (fieldChange)="changeField($event)"
      />

      <footer>
        <button
          type="button"
          [disabled]="busy()"
          (click)="createRequested.emit()"
        >
          {{ 'admin.legacy.ajouter' | translate }}
        </button>
      </footer>
    </section>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-expense-panels.css'
  ]
})
export class AdminExpenseCreateComponent {
  readonly draft = input.required<NewExpenseDraft>();
  readonly busy = input.required<boolean>();
  readonly draftChange = output<NewExpenseFieldChange>();
  readonly createRequested = output<void>();

  changeField(change: ExpenseEditFieldChange): void {
    if (change.field !== 'publishedAt') this.draftChange.emit(change);
  }
}
