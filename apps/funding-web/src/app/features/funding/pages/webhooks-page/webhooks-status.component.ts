import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';

import type { StripeSetupDevStatus } from '../../services/stripe-setup-dev.service.js';

import { webhooksTransparencySourceLabel } from './webhooks-presentation.js';

@Component({
  selector: 'openg7-webhooks-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './webhooks-status.component.html',
  styleUrls: ['./webhooks-panel.css', './webhooks-status.component.css']
})
export class WebhooksStatusComponent {
  readonly status = input.required<StripeSetupDevStatus>();
  readonly sourceLabel = computed(() =>
    webhooksTransparencySourceLabel(this.status().transparencySource)
  );
}
