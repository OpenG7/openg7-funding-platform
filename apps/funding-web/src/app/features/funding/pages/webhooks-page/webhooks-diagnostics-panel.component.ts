import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { WebhookDiagnostic } from './webhooks-presentation.js';

@Component({
  selector: 'openg7-webhooks-diagnostics-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './webhooks-diagnostics-panel.component.html',
  styleUrls: [
    './webhooks-panel.css',
    './webhooks-diagnostics-panel.component.css'
  ]
})
export class WebhooksDiagnosticsPanelComponent {
  readonly diagnostics = input.required<readonly WebhookDiagnostic[]>();
  readonly refreshRequested = output<void>();
}
