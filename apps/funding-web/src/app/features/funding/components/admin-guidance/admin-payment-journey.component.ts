import {
  ChangeDetectionStrategy,
  Component,
  effect,
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

  constructor() {
    effect((onCleanup) => {
      const language = this.i18n.currentLanguage();
      let current = true;
      onCleanup(() => (current = false));
      const locale =
        language === 'en'
          ? import('../../../../../assets/i18n/admin-publication-schedule.en.json')
          : import('../../../../../assets/i18n/admin-publication-schedule.fr-CA.json');
      void locale
        .then(({ default: translations }) => {
          if (current)
            this.i18n.mergeTranslations(language, {
              admin: {
                guidance: { paymentJourney: translations.paymentJourney }
              }
            });
        })
        .catch(() => {
          // The existing generic journey copy remains usable if feature copy cannot load.
        });
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    const path = 'admin.guidance.paymentJourney.' + key;
    const text = this.i18n.t(path, params);
    if (text === path && key === 'platformWaiting')
      return this.t('situations.waiting');
    if (text === path && key === 'viewWaiting') return this.t('openNext');
    return text;
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
