import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipProgress } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminBadgeComponent } from '../admin-ui/admin-badge.component.js';

import { AdminSponsorshipPublicationComponent } from './admin-sponsorship-publication.component.js';

/** Presentation molecule: persisted financial and publication facts, no mutations. */
@Component({
  selector: 'openg7-admin-sponsorship-facts',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminBadgeComponent,
    AdminSponsorshipPublicationComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-facts.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsorship-facts.component.css'
  ]
})
export class AdminSponsorshipFactsComponent {
  readonly canManageWebsite = input(false);
  readonly websiteDisabled = input(false);
  readonly websiteMessage = input('');
  readonly changeWebsiteVisibility = output<boolean>();
  readonly editWebsite = output<void>();
  readonly commitmentChanged = output<void>();
  private readonly i18n = inject(FundingI18nService);
  readonly dossier = input<AdminSponsorshipProgress | null>(null);
  readonly view = input.required<
    'billing' | 'publication' | 'refund' | 'overview'
  >();

  money(amount: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency,
      currencyDisplay: 'code'
    }).format(amount / 100);
  }

  date(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium'
    }).format(new Date(value));
  }
}
