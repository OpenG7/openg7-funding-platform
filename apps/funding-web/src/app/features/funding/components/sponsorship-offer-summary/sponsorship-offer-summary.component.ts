import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { SponsorshipOfferSnapshot } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Funding molecule: display server offer terms in Checkout and private follow-up. */
@Component({
  selector: 'openg7-sponsorship-offer-summary',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-offer-summary.component.html',
  styleUrl: './sponsorship-offer-summary.component.css'
})
export class SponsorshipOfferSummaryComponent {
  readonly offer = input.required<SponsorshipOfferSnapshot>();
  private readonly i18n = inject(FundingI18nService);
  readonly amount = computed(() =>
    new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: this.offer().currency
    }).format(this.offer().amountMinor / 100)
  );
}
