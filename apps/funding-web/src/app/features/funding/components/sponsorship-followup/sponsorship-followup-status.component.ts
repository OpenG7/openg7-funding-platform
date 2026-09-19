import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { SponsorshipFollowupResponse } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

@Component({
  selector: 'openg7-sponsorship-followup-status',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-followup-status.component.html',
  styleUrls: ['./sponsorship-followup.css']
})
export class SponsorshipFollowupStatusComponent {
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
