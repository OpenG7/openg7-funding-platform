import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { SetupStep } from './stripe-setup-projections.js';

@Component({
  selector: 'openg7-stripe-setup-steps',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stripe-setup-steps.component.html',
  styleUrls: [
    './stripe-setup-controls.css',
    './stripe-setup-steps.component.css'
  ]
})
export class StripeSetupStepsComponent {
  readonly steps = input.required<readonly SetupStep[]>();
  readonly completedStepIds = input.required<readonly string[]>();
  readonly toggle = output<string>();
  readonly copy = output<string>();
  readonly open = output<string>();

  isCompleted(stepId: string): boolean {
    return this.completedStepIds().includes(stepId);
  }
}
