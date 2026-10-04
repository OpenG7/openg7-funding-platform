import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
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

import { StripeSetupAccountPanelsComponent } from './stripe-setup-account-panels.component.js';
import { StripeSetupDiagnosticPanelsComponent } from './stripe-setup-diagnostic-panels.component.js';
import { StripeSetupProgressComponent } from './stripe-setup-progress.component.js';
import { StripeSetupStepsComponent } from './stripe-setup-steps.component.js';
import {
  stripeSetupAccountDiagnostic,
  stripeSetupSecurityChecks,
  stripeSetupStages,
  stripeSetupSteps,
  stripeSetupWebhookDiagnostic,
  type StripeSetupPaymentMode
} from './stripe-setup-projections.js';

const storageKey = 'openg7.stripeSetup.completedSteps.v1';

@Component({
  selector: 'openg7-stripe-setup-page',
  standalone: true,
  imports: [
    CommonModule,
    StripeSetupAccountPanelsComponent,
    StripeSetupDiagnosticPanelsComponent,
    StripeSetupProgressComponent,
    StripeSetupStepsComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stripe-setup-page.component.html',
  styleUrls: [
    './stripe-setup-controls.css',
    './stripe-setup-page.component.css'
  ]
})
export class StripeSetupPageComponent implements OnInit {
  private readonly setupService = inject(StripeSetupDevService);

  readonly status = signal<StripeSetupDevStatus>(DEV_TOOLS_FALLBACK_STATUS);
  readonly completedStepIds = signal<readonly string[]>(
    this.loadCompletedSteps()
  );
  readonly loadError = signal<boolean>(false);
  readonly paymentMode = signal<StripeSetupPaymentMode>('live');
  readonly accountDiagnostic = computed(() =>
    stripeSetupAccountDiagnostic(this.status())
  );
  readonly webhookDiagnostic = computed(() =>
    stripeSetupWebhookDiagnostic(this.status())
  );
  readonly setupStages = computed(() =>
    stripeSetupStages(this.status(), this.paymentMode())
  );
  readonly securityChecks = computed(() =>
    stripeSetupSecurityChecks(this.status())
  );
  readonly steps = computed(() => stripeSetupSteps(this.status()));

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

  setPaymentMode(mode: StripeSetupPaymentMode): void {
    this.paymentMode.set(mode);
  }

  toggleCompleted(stepId: string): void {
    const completed = this.completedStepIds();
    const next = completed.includes(stepId)
      ? completed.filter((id) => id !== stepId)
      : [...completed, stepId];

    this.completedStepIds.set(next);
    this.saveCompletedSteps(next);
  }

  openUrl(url: string): void {
    openDevToolsUrl(url);
  }

  async copyText(value: string): Promise<void> {
    await copyDevToolsText(value);
  }

  private loadCompletedSteps(): readonly string[] {
    try {
      if (typeof window === 'undefined') return [];
      const rawValue = window.localStorage.getItem(storageKey);
      if (!rawValue) return [];
      const parsed: unknown = JSON.parse(rawValue);
      return Array.isArray(parsed) &&
        parsed.every((value) => typeof value === 'string')
        ? parsed
        : [];
    } catch {
      return [];
    }
  }

  private saveCompletedSteps(stepIds: readonly string[]): void {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(storageKey, JSON.stringify(stepIds));
    } catch {
      // Step completion stays available for this page when storage is denied.
    }
  }
}
