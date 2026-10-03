import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminAccessAccount } from '../../services/funding-admin.service.js';

import type { AdminAccessFieldChange } from './admin-access-presentation.types.js';

/** Admin organism: account fields; the page validates, confirms and submits. */
@Component({
  selector: 'openg7-admin-access-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './admin-access-editor.component.html',
  styleUrls: [
    './admin-access-controls.css',
    './admin-access-editor.component.css'
  ]
})
export class AdminAccessEditorComponent {
  readonly draft = input.required<AdminAccessAccount>();
  readonly busy = input.required<boolean>();
  readonly confirmed = input.required<boolean>();
  readonly fieldChanged = output<AdminAccessFieldChange>();
  readonly confirmationChanged = output<boolean>();
  readonly newRequested = output<void>();
  readonly saveRequested = output<void>();
  readonly roles = ['reader', 'operator', 'owner'] as const;
}
