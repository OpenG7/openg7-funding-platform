import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { ApiKeyCard } from './api-keys-catalog.js';

/** Local Stripe diagnostic presentation; the routed page owns loading and browser actions. */
@Component({
  selector: 'openg7-api-key-cards',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './api-key-cards.component.html',
  styleUrls: ['./api-keys-panel.css', './api-key-cards.component.css']
})
export class ApiKeyCardsComponent {
  readonly cards = input.required<readonly ApiKeyCard[]>();
  readonly copy = output<string>();
}
