import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { SetupStage } from './stripe-setup-projections.js';

@Component({
  selector: 'openg7-stripe-setup-progress',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stripe-setup-progress.component.html',
  styleUrls: [
    './stripe-setup-controls.css',
    './stripe-setup-progress.component.css'
  ]
})
export class StripeSetupProgressComponent {
  readonly stages = input.required<readonly SetupStage[]>();
}
