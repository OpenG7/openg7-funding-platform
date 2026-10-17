import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipRecord } from '@openg7/funding-core';

import type { AdminSponsorDetailOverviewView } from '../../models/admin-sponsors-ui.models.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Contact details and sponsor submission stay distinct within the profile. */
@Component({
  selector: 'openg7-admin-sponsor-detail-identity',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-detail-identity.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-detail-identity.component.css'
  ]
})
export class AdminSponsorDetailIdentityComponent {
  private readonly i18n = inject(FundingI18nService);
  readonly identity = input.required<AdminSponsorDetailOverviewView>();
  readonly sponsorship =
    input.required<
      Pick<
        AdminSponsorshipRecord,
        | 'sponsor_company_name'
        | 'sponsor_contact_email'
        | 'sponsor_details_submitted_at'
      >
    >();
  readonly canEdit = input(false);
  readonly canResendAccess = input(false);
  readonly disabled = input(false);
  readonly editRequested = output<void>();
  readonly accessRequested = output<void>();
  readonly coordinatesComplete = computed(() =>
    Boolean(
      this.sponsorship().sponsor_company_name?.trim() &&
      this.sponsorship().sponsor_contact_email?.trim()
    )
  );
  readonly submittedAtLabel = computed(() => {
    const value = this.sponsorship().sponsor_details_submitted_at;
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium'
    }).format(date);
  });
}
