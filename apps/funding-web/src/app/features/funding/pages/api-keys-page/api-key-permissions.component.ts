import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { ApiKeyPermission } from './api-keys-catalog.js';

/** Local Stripe diagnostic presentation; the routed page owns loading and browser actions. */
@Component({
  selector: 'openg7-api-key-permissions',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './api-key-permissions.component.html',
  styleUrls: ['./api-keys-panel.css', './api-key-permissions.component.css']
})
export class ApiKeyPermissionsComponent {
  readonly permissions = input.required<readonly ApiKeyPermission[]>();
}
