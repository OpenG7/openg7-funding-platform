import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';

import { copyDevToolsText } from '../../components/dev-tools/dev-tools-browser.js';
import { DEV_TOOLS_FALLBACK_STATUS } from '../../components/dev-tools/dev-tools-status.js';
import {
  StripeSetupDevService,
  type StripeSetupDevStatus
} from '../../services/stripe-setup-dev.service.js';

import { ApiKeyCardsComponent } from './api-key-cards.component.js';
import { ApiKeyRotationComponent } from './api-key-rotation.component.js';
import { ApiKeyPermissionsComponent } from './api-key-permissions.component.js';
import { ApiKeyCommandsComponent } from './api-key-commands.component.js';
import {
  API_KEY_ROTATION_STEPS,
  API_KEY_PERMISSIONS,
  API_KEY_AUDIT_ROWS,
  API_KEY_COMMANDS,
  projectApiKeyCards
} from './api-keys-catalog.js';

@Component({
  selector: 'openg7-api-keys-page',
  standalone: true,
  imports: [
    CommonModule,
    ApiKeyCardsComponent,
    ApiKeyRotationComponent,
    ApiKeyPermissionsComponent,
    ApiKeyCommandsComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './api-keys-page.component.html',
  styleUrls: ['./api-keys-panel.css', './api-keys-page.component.css']
})
export class ApiKeysPageComponent implements OnInit {
  private readonly setupService = inject(StripeSetupDevService);

  readonly status = signal<StripeSetupDevStatus>(DEV_TOOLS_FALLBACK_STATUS);
  readonly loadError = signal<boolean>(false);

  readonly rotationSteps = API_KEY_ROTATION_STEPS;
  readonly permissions = API_KEY_PERMISSIONS;
  readonly auditRows = API_KEY_AUDIT_ROWS;
  readonly commands = API_KEY_COMMANDS;
  readonly keyCards = computed(() => projectApiKeyCards(this.status()));

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

  async copyText(value: string): Promise<void> {
    await copyDevToolsText(value);
  }
}
