import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { StripeSetupDevStatus } from '../../services/stripe-setup-dev.service.js';

@Component({
  selector: 'openg7-webhooks-endpoint-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './webhooks-endpoint-panel.component.html',
  styleUrls: ['./webhooks-panel.css', './webhooks-endpoint-panel.component.css']
})
export class WebhooksEndpointPanelComponent {
  readonly status = input.required<StripeSetupDevStatus>();
  readonly copyRequested = output<string>();
  readonly openRequested = output<string>();
  readonly refreshRequested = output<void>();
}
