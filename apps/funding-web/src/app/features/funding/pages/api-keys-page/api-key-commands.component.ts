import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { ApiKeyCommand } from './api-keys-catalog.js';

/** Local Stripe diagnostic presentation; the routed page owns loading and browser actions. */
@Component({
  selector: 'openg7-api-key-commands',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './api-key-commands.component.html',
  styleUrls: ['./api-keys-panel.css', './api-key-commands.component.css']
})
export class ApiKeyCommandsComponent {
  readonly commands = input.required<readonly ApiKeyCommand[]>();
  readonly copy = output<string>();
}
