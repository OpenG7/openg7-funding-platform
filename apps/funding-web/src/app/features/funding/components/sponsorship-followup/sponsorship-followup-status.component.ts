import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  SponsorshipFollowupResponse,
  SponsorshipPublicObligation
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { publicHttpsUrl } from '../../models/public-sponsors.utils.js';
import { SponsorshipOfferSummaryComponent } from '../sponsorship-offer-summary/sponsorship-offer-summary.component.js';

@Component({
  selector: 'openg7-sponsorship-followup-status',
  standalone: true,
  imports: [CommonModule, TranslatePipe, SponsorshipOfferSummaryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-followup-status.component.html',
  styleUrls: ['./sponsorship-followup.css']
})
export class SponsorshipFollowupStatusComponent {
  private readonly document = inject(DOCUMENT);
  readonly evidenceUrl = publicHttpsUrl;
  evidenceFor(obligation: SponsorshipPublicObligation) {
    if (obligation.state !== 'fulfilled' || !obligation.fulfilmentEvidenceId)
      return null;
    return (
      this.followup().fulfilmentEvidence?.find(
        (evidence) =>
          evidence.id === obligation.fulfilmentEvidenceId &&
          evidence.obligationId === obligation.id &&
          evidence.channel === obligation.channel &&
          evidence.target === obligation.target
      ) ?? null
    );
  }
  evidenceAnchor(id: string): string {
    return 'sponsorship-evidence-' + id;
  }
  evidenceHref(id: string): string {
    const location = this.document.defaultView?.location;
    if (!location) return '#' + this.evidenceAnchor(id);
    const current = new URL(location.href);
    current.searchParams.delete('token');
    current.hash = this.evidenceAnchor(id);
    return current.pathname + current.search + current.hash;
  }
  focusEvidence(id: string): void {
    this.document
      .getElementById(this.evidenceAnchor(id))
      ?.focus({ preventScroll: true });
  }
  dateLabel(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(date)
      : this.i18n.t('funding.followup.status.unavailable');
  }
  readonly followup = input.required<SponsorshipFollowupResponse>();
  readonly i18n = inject(FundingI18nService);
  readonly paymentKey = computed(() => {
    const status = this.followup().paymentStatus;
    return [
      'paid',
      'pending',
      'failed',
      'expired',
      'refunded',
      'disputed'
    ].includes(status)
      ? status
      : 'unknown';
  });
  readonly amount = computed(() =>
    new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: this.followup().currency
    }).format(this.followup().amount)
  );
  readonly reviewedAt = computed(() => {
    const value = this.followup().reviewedAt;
    if (!value || Number.isNaN(Date.parse(value)))
      return this.i18n.t('funding.followup.status.unavailable');
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  });
}
