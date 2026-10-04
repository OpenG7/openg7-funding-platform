import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { ApiKeyRotationStep } from './api-keys-catalog.js';

/** Local Stripe diagnostic presentation; the routed page owns loading and browser actions. */
@Component({
  selector: 'openg7-api-key-rotation',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './api-key-rotation.component.html',
  styleUrls: ['./api-keys-panel.css', './api-key-rotation.component.css']
})
export class ApiKeyRotationComponent {
  readonly steps = input.required<readonly ApiKeyRotationStep[]>();
}
