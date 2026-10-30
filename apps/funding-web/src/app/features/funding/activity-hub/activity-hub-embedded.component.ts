import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import { ActivityHubWorkspaceComponent } from './activity-hub-workspace.component.js';

/** Public composition surface: visit-local content inside the administrative guide. */
@Component({
  selector: 'openg7-activity-hub-embedded',
  standalone: true,
  imports: [ActivityHubWorkspaceComponent],
  host: { class: 'activity-hub-embedded', 'data-og7': 'activity-hub-embedded' },
  template:
    '<openg7-activity-hub-workspace [embedded]="true" [active]="active()" (serviceDeliveryRequested)="serviceDeliveryRequested.emit($event)" />',
  styles: [
    ':host { display: block; width: 100%; min-width: 0; min-height: 0; }'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityHubEmbeddedComponent {
  readonly active = input(true);
  readonly serviceDeliveryRequested = output<string | null>();
}
