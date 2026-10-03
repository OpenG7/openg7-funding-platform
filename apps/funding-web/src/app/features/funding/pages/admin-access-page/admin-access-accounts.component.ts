import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminAccessAccount } from '../../services/funding-admin.service.js';

/** Admin organism: account list; editing and permissions remain in the page. */
@Component({
  selector: 'openg7-admin-access-accounts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './admin-access-accounts.component.html',
  styleUrl: './admin-access-controls.css'
})
export class AdminAccessAccountsComponent {
  readonly accounts = input.required<readonly AdminAccessAccount[]>();
  readonly busy = input.required<boolean>();
  readonly editRequested = output<AdminAccessAccount>();
}
