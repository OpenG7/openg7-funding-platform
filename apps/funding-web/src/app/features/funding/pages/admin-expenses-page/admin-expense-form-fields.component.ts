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
import type {
  ExpenseEditFieldChange,
  ExpenseTextField,
  NewExpenseDraft
} from './admin-expense-presentation.types.js';

/** Admin molecule: allocation fields with no draft, version or mutation ownership. */
@Component({
  selector: 'openg7-admin-expense-form-fields',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-expense-form-fields.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-expense-fields.css'
  ]
})
export class AdminExpenseFormFieldsComponent {
  readonly draft = input.required<NewExpenseDraft>();
  readonly publishedAt = input<string | null>(null);
  readonly fieldChange = output<ExpenseEditFieldChange>();
  readonly expenseStatuses = expenseStatuses;
  readonly statusKeys = expenseStatusTranslationKeys;

  setTextField(field: ExpenseTextField, event: Event): void {
    this.fieldChange.emit({ field, value: this.valueFromEvent(event) });
  }

  setStatus(event: Event): void {
    const value = this.valueFromEvent(event);
    this.fieldChange.emit({
      field: 'status',
      value: expenseStatuses.includes(value as AdminExpenseStatus)
        ? (value as AdminExpenseStatus)
        : 'draft'
    });
  }

  setProgressStatus(event: Event): void {
    const value = this.valueFromEvent(event);
    this.fieldChange.emit({
      field: 'progressStatus',
      value:
        value === 'in_progress' || value === 'delivered' ? value : 'planned'
    });
  }

  private valueFromEvent(event: Event): string {
    return (
      (
        event.target as
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
      )?.value ?? ''
    );
  }
}
