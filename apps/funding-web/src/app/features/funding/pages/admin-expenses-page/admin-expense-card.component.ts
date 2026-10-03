import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminExpenseRecord,
  AdminExpenseStatus
} from '@openg7/funding-core';

import { AdminExpenseFormFieldsComponent } from './admin-expense-form-fields.component.js';
import { expenseStatusTranslationKeys } from './admin-expense-presentation.types.js';
import type {
  ExpenseEdit,
  ExpenseEditFieldChange
} from './admin-expense-presentation.types.js';

/** Admin organism: one allocation and its edit controls; no mutation ownership. */
@Component({
  selector: 'openg7-admin-expense-card',
  standalone: true,
  imports: [TranslatePipe, AdminExpenseFormFieldsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="expense-card"
      data-og7="allocation-card"
      [attr.data-og7-id]="expense().id"
    >
      <header>
        <div>
          <span>{{ statusKeys[expense().status] | translate }}</span>
          <h2>{{ expense().project_name }}</h2>
        </div>
        <strong>{{ amountLabel() }}</strong>
        <button type="button" (click)="proofRequested.emit()">
          {{ 'admin.inspector.kinds.proof' | translate }}
        </button>
      </header>

      <openg7-admin-expense-form-fields
        [draft]="edit()"
        [publishedAt]="edit().publishedAt"
        (fieldChange)="editChange.emit($event)"
      />

      <footer>
        <button
          type="button"
          [disabled]="busy()"
          (click)="saveRequested.emit(undefined)"
        >
          {{ 'admin.legacy.enregistrer' | translate }}
        </button>
        <button
          type="button"
          class="approve"
          [disabled]="busy()"
          (click)="saveRequested.emit('published')"
        >
          {{ 'admin.legacy.publier' | translate }}
        </button>
        <button
          type="button"
          class="neutral"
          [disabled]="busy()"
          (click)="saveRequested.emit('private')"
        >
          {{ 'admin.legacy.masquer' | translate }}
        </button>
        <button
          type="button"
          class="reject"
          [disabled]="busy()"
          (click)="saveRequested.emit('archived')"
        >
          {{ 'admin.legacy.archiver' | translate }}
        </button>
      </footer>
    </article>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-expense-panels.css'
  ]
})
export class AdminExpenseCardComponent {
  readonly expense = input.required<AdminExpenseRecord>();
  readonly edit = input.required<ExpenseEdit>();
  readonly busy = input.required<boolean>();
  readonly amountLabel = input.required<string>();
  readonly editChange = output<ExpenseEditFieldChange>();
  readonly saveRequested = output<AdminExpenseStatus | undefined>();
  readonly proofRequested = output<void>();
  readonly statusKeys = expenseStatusTranslationKeys;
}
