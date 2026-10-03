import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';

import type { SetupChecklistItem, SetupSection } from './setup-projections.js';

/** Setup presentation section; the routed page owns state and effects. */
@Component({
  selector: 'openg7-admin-setup-checklist',
  standalone: true,
  imports: [TranslatePipe, AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-setup-checklist.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-setup-presentation.css',
    './admin-setup-checklist.component.css'
  ]
})
export class AdminSetupChecklistComponent {
  readonly items = input.required<readonly SetupChecklistItem[]>();
  readonly completeCount = input.required<number>();
  readonly inspect = output<SetupSection | 'invoice'>();
}
