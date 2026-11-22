import { NgTemplateOutlet } from '@angular/common';
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
  imports: [NgTemplateOutlet, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-offer-summary.component.html',
  styleUrl: './sponsorship-offer-summary.component.css',
  host: { '[class.compact-mode]': 'compact()' }
})
export class SponsorshipOfferSummaryComponent {
  readonly offer = input.required<SponsorshipOfferSnapshot>();
  readonly compact = input(false);
  private readonly i18n = inject(FundingI18nService);
  readonly amount = computed(() =>
    new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: this.offer().currency
    }).format(this.offer().amountMinor / 100)
  );

  benefitCategory(
    benefit: SponsorshipOfferSnapshot['benefits'][number]
  ): 'web' | 'collective' | 'individual' | null {
    if (benefit.channel === 'website') return 'web';
    switch (benefit.format) {
      case 'collective_text':
      case 'collective_composite':
      case 'image_collection':
        return 'collective';
      case 'individual_text':
      case 'individual_portrait':
        return 'individual';
      default:
        return null;
    }
  }

  compactFormatKey(
    benefit: SponsorshipOfferSnapshot['benefits'][number]
  ): string {
    if (benefit.format) return 'funding.offer.formats.' + benefit.format;
    return benefit.channel === 'website'
      ? 'funding.offer.webPresence'
      : 'funding.offer.legacyTextFormat';
  }
}
