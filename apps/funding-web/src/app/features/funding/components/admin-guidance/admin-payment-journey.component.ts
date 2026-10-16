import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output
} from '@angular/core';
import type { AdminPaymentJourneyStep } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { AdminPaymentJourneyService } from './admin-payment-journey.service.js';

/** A single server-derived next action, with optional detail and voluntary pause. */
@Component({
  selector: 'openg7-admin-payment-journey',
  standalone: true,
  templateUrl: './admin-payment-journey.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-payment-journey.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPaymentJourneyComponent {
  readonly journey = inject(AdminPaymentJourneyService);
  readonly guidance = this.journey.guidance;
  readonly i18n = inject(FundingI18nService);
  readonly show = output<string>();

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.guidance.paymentJourney.' + key, params);
  }
  reason(reason: string): string {
    for (const key of [
      'admin.guidance.paymentJourney.reasons.' + reason,
      'admin.dossier.reasons.' + reason
    ]) {
      const label = this.i18n.t(key);
      if (label !== key) return label;
    }
    return this.t('reasonUnavailable');
  }
  stepTitle(step: AdminPaymentJourneyStep): string {
    for (const key of [
      'admin.guidance.paymentJourney.steps.' + step.id,
      'admin.dossier.steps.' + step.id
    ]) {
      const label = this.i18n.t(key);
      if (label !== key) return label;
    }
    return this.reason(step.reason);
  }
}
