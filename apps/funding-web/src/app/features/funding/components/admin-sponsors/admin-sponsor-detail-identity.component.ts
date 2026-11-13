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

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';

type IdentityFacts = Pick<
  AdminSponsorshipRecord,
  | 'sponsor_company_name'
  | 'sponsor_contact_name'
  | 'sponsor_contact_email'
  | 'sponsor_website_url'
  | 'public_name'
  | 'public_display_consent'
  | 'sponsor_details_submitted_at'
  | 'sponsor_details_admin_completed_at'
> & { readonly sponsor_message?: string | null };

interface IdentityField {
  readonly id: string;
  readonly label: string;
  readonly icon: AdminIconName;
  readonly value: string | null;
  readonly required: boolean;
  readonly state: 'present' | 'missing' | 'optional' | 'unconsented';
}

const identityText = (value: string | null | undefined): string | null =>
  value?.trim() || null;

/** Contact completion and sponsor submission remain distinct server facts. */
@Component({
  selector: 'openg7-admin-sponsor-detail-identity',
  standalone: true,
  imports: [TranslatePipe, AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-detail-identity.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-sponsor-detail-identity.component.css'
  ]
})
export class AdminSponsorDetailIdentityComponent {
  private readonly i18n = inject(FundingI18nService);
  readonly sponsorship = input.required<IdentityFacts>();
  readonly canEdit = input(false);
  readonly canResendAccess = input(false);
  readonly disabled = input(false);
  readonly editRequested = output<void>();
  readonly accessRequested = output<void>();

  readonly presentation = computed(() => {
    const facts = this.sponsorship();
    const organization = identityText(facts.sponsor_company_name);
    const email = identityText(facts.sponsor_contact_email);
    const publicName = facts.public_display_consent
      ? identityText(facts.public_name)
      : null;
    const field = (
      id: string,
      label: string,
      icon: AdminIconName,
      value: string | null,
      required = false
    ): IdentityField => ({
      id,
      label: 'admin.dossier.' + label,
      icon,
      value,
      required,
      state: value ? 'present' : required ? 'missing' : 'optional'
    });
    const fields: readonly IdentityField[] = [
      field('organization', 'company', 'building', organization, true),
      field('email', 'email', 'email', email, true),
      field(
        'contact',
        'contact',
        'person',
        identityText(facts.sponsor_contact_name)
      ),
      field(
        'website',
        'website',
        'globe',
        identityText(facts.sponsor_website_url)
      ),
      {
        ...field('public-name', 'publicName', 'tag', publicName),
        state: facts.public_display_consent
          ? publicName
            ? 'present'
            : 'optional'
          : 'unconsented'
      }
    ];
    const submittedAt = facts.sponsor_details_submitted_at;
    const coordinatesComplete = Boolean(organization && email);
    const completedByAdmin = Boolean(
      coordinatesComplete &&
      !submittedAt &&
      facts.sponsor_details_admin_completed_at
    );
    const date = submittedAt ? new Date(submittedAt) : null;
    return {
      fields,
      coordinatesComplete,
      completedByAdmin,
      submitted: Boolean(submittedAt),
      submittedAt,
      submittedAtLabel:
        date && Number.isFinite(date.getTime())
          ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
              dateStyle: 'medium'
            }).format(date)
          : null
    };
  });
}
