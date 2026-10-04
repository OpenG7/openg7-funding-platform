import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { WebhookEvent } from './webhooks-presentation.js';

@Component({
  selector: 'openg7-webhooks-event-catalog',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './webhooks-event-catalog.component.html',
  styleUrls: ['./webhooks-panel.css', './webhooks-event-catalog.component.css']
})
export class WebhooksEventCatalogComponent {
  readonly events = input.required<readonly WebhookEvent[]>();
}
