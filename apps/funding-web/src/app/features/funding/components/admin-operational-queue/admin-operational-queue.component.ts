import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type {
  AdminAttentionItem,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import fr from '../../../../../assets/i18n/admin-operational-queue.fr-CA.json' with { type: 'json' };
import en from '../../../../../assets/i18n/admin-operational-queue.en.json' with { type: 'json' };
import frSchedule from '../../../../../assets/i18n/admin-publication-schedule.fr-CA.json' with { type: 'json' };
import enSchedule from '../../../../../assets/i18n/admin-publication-schedule.en.json' with { type: 'json' };
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Shared Funding organism; one canonical queue, no HTTP, decision or mutation. */
@Component({
  selector: 'openg7-admin-operational-queue',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './admin-operational-queue.component.html',
  styleUrl: './admin-operational-queue.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminOperationalQueueComponent {
  readonly queue = input<AdminWorkQueueResponse | null>(null);
  readonly loading = input(false);
  readonly stale = input(false);
  readonly compact = input(false);
  readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  readonly recommendations = computed(() =>
    (this.queue()?.overview?.recommendations ?? []).filter(
      (item) =>
        item.severity !== 'informational' &&
        item.intervention?.responsibility !== 'platform'
    )
  );
  readonly platformItems = computed(() =>
    (this.queue()?.items ?? [])
      .filter((item) => item.intervention?.responsibility === 'platform')
      .slice(0, 3)
  );
  constructor() {
    this.i18n.mergeTranslations('fr-CA', {
      admin: {
        operationalQueue: fr,
        guidance: { paymentJourney: frSchedule.paymentJourney }
      }
    });
    this.i18n.mergeTranslations('en', {
      admin: {
        operationalQueue: en,
        guidance: { paymentJourney: enSchedule.paymentJourney }
      }
    });
  }
  t(key: string): string {
    return this.i18n.t('admin.operationalQueue.' + key);
  }
  reason(item: AdminAttentionItem): string {
    const reason = item.intervention?.reason ?? item.facts['reason'];
    for (const key of [
      'admin.operationalQueue.reasons.' + reason,
      'admin.guidance.paymentJourney.reasons.' + reason,
      'admin.dossier.reasons.' + reason,
      'admin.attention.reasons.' + item.type
    ]) {
      const value = this.i18n.t(key);
      if (value !== key) return value;
    }
    return this.t('reasonUnknown');
  }
  type(item: AdminAttentionItem): string {
    const key = 'admin.attention.types.' + item.type;
    const value = this.i18n.t(key);
    return value === key ? this.t('reasonUnknown') : value;
  }
  link(item: AdminAttentionItem) {
    const url = item.adminUrl ?? '/admin/fundraiser/attention';
    return this.router.parseUrl(
      /^\/admin\/fundraiser(?:[/?#]|$)/.test(url)
        ? url
        : '/admin/fundraiser/attention'
    );
  }
}
