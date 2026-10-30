import { ChangeDetectionStrategy, Component } from '@angular/core';

import { ActivityHubWorkspaceComponent } from './activity-hub-workspace.component.js';

/** Standalone route host for the shared news and inspiration workspace. */
@Component({
  selector: 'openg7-activity-hub-page',
  standalone: true,
  imports: [ActivityHubWorkspaceComponent],
  template: '<openg7-activity-hub-workspace />',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityHubPageComponent {}
