import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { CheckoutNoticeStatus } from '../../services/checkout-status-monitor.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Funding organism: presents server-confirmed status and follow-up actions. */
@Component({
  selector: 'openg7-funding-checkout-notice',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-checkout-notice.component.html',
  host: { '[attr.aria-busy]': 'checking()' },
  styles: [':host { display: block; }']
})
export class FundingCheckoutNoticeComponent {
  private readonly i18n = inject(FundingI18nService);
  readonly checkoutStatus = input.required<CheckoutNoticeStatus>();
  readonly pendingSponsorFollowupToken = input<string | null>(null);
  readonly paused = input(false);
  readonly checking = input(false);
  readonly canRetry = input(false);
  readonly dismissed = output<void>();
  readonly supportRequested = output<void>();
  readonly retryRequested = output<void>();
  readonly showSponsorFollowUp = computed(
    () =>
      (this.checkoutStatus() === 'pending' ||
        this.checkoutStatus() === 'confirmed') &&
      this.pendingSponsorFollowupToken() !== null
  );
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly sponsorshipFollowupPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/suivi-commandite')
  );
}
