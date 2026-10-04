import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type {
  StripeSetupAccountDiagnostic,
  StripeSetupPaymentMode
} from './stripe-setup-projections.js';

@Component({
  selector: 'openg7-stripe-setup-account-panels',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stripe-setup-account-panels.component.html',
  styleUrls: [
    './stripe-setup-controls.css',
    './stripe-setup-account-panels.component.css'
  ]
})
export class StripeSetupAccountPanelsComponent {
  readonly account = input.required<StripeSetupAccountDiagnostic>();
  readonly paymentMode = input.required<StripeSetupPaymentMode>();
  readonly copy = output<string>();
  readonly open = output<string>();
  readonly modeChange = output<StripeSetupPaymentMode>();
}
