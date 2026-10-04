import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal
} from '@angular/core';

import {
  copyDevToolsText,
  openDevToolsUrl
} from '../../components/dev-tools/dev-tools-browser.js';
import { DEV_TOOLS_FALLBACK_STATUS } from '../../components/dev-tools/dev-tools-status.js';
import {
  StripeSetupDevService,
  StripeSetupDevStatus
} from '../../services/stripe-setup-dev.service.js';

import { WebhooksCommandsPanelComponent } from './webhooks-commands-panel.component.js';
import { WebhooksDiagnosticsPanelComponent } from './webhooks-diagnostics-panel.component.js';
import { WebhooksEndpointPanelComponent } from './webhooks-endpoint-panel.component.js';
import { WebhooksEventCatalogComponent } from './webhooks-event-catalog.component.js';
import {
  WEBHOOK_COMMANDS,
  WEBHOOK_DIAGNOSTICS,
  WEBHOOK_EVENTS
} from './webhooks-presentation.js';
import { WebhooksStatusComponent } from './webhooks-status.component.js';

@Component({
  selector: 'openg7-webhooks-page',
  standalone: true,
  imports: [
    WebhooksStatusComponent,
    WebhooksEndpointPanelComponent,
    WebhooksEventCatalogComponent,
    WebhooksCommandsPanelComponent,
    WebhooksDiagnosticsPanelComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './webhooks-page.component.html',
  styleUrls: ['./webhooks-panel.css', './webhooks-page.component.css']
})
export class WebhooksPageComponent implements OnInit {
  private readonly setupService = inject(StripeSetupDevService);

  readonly status = signal<StripeSetupDevStatus>(DEV_TOOLS_FALLBACK_STATUS);
  readonly loadError = signal<boolean>(false);
  readonly events = WEBHOOK_EVENTS;
  readonly commands = WEBHOOK_COMMANDS;
  readonly diagnostics = WEBHOOK_DIAGNOSTICS;

  async ngOnInit(): Promise<void> {
    await this.refreshStatus();
  }

  async refreshStatus(): Promise<void> {
    try {
      this.status.set(await this.setupService.getStatus());
      this.loadError.set(false);
    } catch {
      this.status.set(DEV_TOOLS_FALLBACK_STATUS);
      this.loadError.set(true);
    }
  }

  openUrl(url: string): void {
    openDevToolsUrl(url);
  }

  async copyText(value: string): Promise<void> {
    await copyDevToolsText(value);
  }
}
