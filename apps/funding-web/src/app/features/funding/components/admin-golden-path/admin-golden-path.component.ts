import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { SponsorshipGoldenPathObservation } from '@openg7/funding-core';

import en from '../../../../../assets/i18n/admin-golden-path.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-golden-path.fr-CA.json' with { type: 'json' };
import enSchedule from '../../../../../assets/i18n/admin-publication-schedule.en.json' with { type: 'json' };
import frSchedule from '../../../../../assets/i18n/admin-publication-schedule.fr-CA.json' with { type: 'json' };
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Funding organism: displays owner observations; no HTTP, mutation or eligibility policy. */
@Component({
  selector: 'openg7-admin-golden-path',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './admin-golden-path.component.html',
  styleUrl: './admin-golden-path.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminGoldenPathComponent {
  readonly observation =
    input.required<SponsorshipGoldenPathObservation | null>();
  readonly stale = input(false);
  readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  constructor() {
    this.i18n.mergeTranslations('fr-CA', {
      admin: {
        goldenPath: fr,
        guidance: { paymentJourney: frSchedule.paymentJourney }
      }
    });
    this.i18n.mergeTranslations('en', {
      admin: {
        goldenPath: en,
        guidance: { paymentJourney: enSchedule.paymentJourney }
      }
    });
  }
  t(key: string): string {
    return this.i18n.t('admin.goldenPath.' + key);
  }
  label(group: string, value: string | null | undefined): string {
    const key = 'admin.goldenPath.' + group + '.' + (value ?? 'unknown');
    const label = this.i18n.t(key);
    return label === key ? this.t('unknown') : label;
  }
  reason(value: string): string {
    for (const prefix of [
      'admin.goldenPath.reasons.',
      'admin.dossier.reasons.',
      'admin.guidance.paymentJourney.reasons.'
    ]) {
      const key = prefix + value;
      const label = this.i18n.t(key);
      if (key !== label) return label;
    }
    return this.t('reasonDetail');
  }
  link(value: string) {
    return this.router.parseUrl(
      /^\/admin\/fundraiser(?:[/?#]|$)/.test(value)
        ? value
        : '/admin/fundraiser'
    );
  }
  date(value: string | null): string {
    if (!value || !Number.isFinite(Date.parse(value))) return this.t('unknown');
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Toronto'
    }).format(new Date(value));
  }
  amount(minor: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency
    }).format(minor / 100);
  }
}
