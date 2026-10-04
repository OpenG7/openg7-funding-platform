import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { DevToolsCommand } from '../../components/dev-tools/dev-tools-command.js';

@Component({
  selector: 'openg7-webhooks-commands-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './webhooks-commands-panel.component.html',
  styleUrls: ['./webhooks-panel.css', './webhooks-commands-panel.component.css']
})
export class WebhooksCommandsPanelComponent {
  readonly commands = input.required<readonly DevToolsCommand[]>();
  readonly copyRequested = output<string>();
}
