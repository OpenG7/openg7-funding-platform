import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type {
  SecurityCheck,
  StripeSetupPaymentMode,
  StripeSetupWebhookDiagnostic
} from './stripe-setup-projections.js';

@Component({
  selector: 'openg7-stripe-setup-diagnostic-panels',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stripe-setup-diagnostic-panels.component.html',
  styleUrls: [
    './stripe-setup-controls.css',
    './stripe-setup-diagnostic-panels.component.css'
  ]
})
export class StripeSetupDiagnosticPanelsComponent {
  readonly webhook = input.required<StripeSetupWebhookDiagnostic>();
  readonly securityChecks = input.required<readonly SecurityCheck[]>();
  readonly copy = output<string>();
  readonly open = output<string>();
  readonly refresh = output<void>();
  readonly modeChange = output<StripeSetupPaymentMode>();
}
