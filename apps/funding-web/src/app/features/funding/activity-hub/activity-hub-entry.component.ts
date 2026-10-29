import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminIconComponent } from '../components/admin-ui/admin-icon.component.js';

import type { HubEntry } from './activity-hub-fixtures.js';

/** Internal presentation molecule: one editorial entry and its reading controls. */
@Component({
  selector: 'openg7-activity-hub-entry',
  standalone: true,
  imports: [AdminIconComponent, TranslatePipe],
  templateUrl: './activity-hub-entry.component.html',
  styleUrl: './activity-hub-entry.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityHubEntryComponent {
  readonly entry = input.required<HubEntry>();
  readonly saved = input(false);
  readonly read = input(false);
  readonly featured = input(false);
  readonly dateLabel = input.required<string>();
  readonly opened = output<void>();
  readonly saveToggled = output<void>();
}
