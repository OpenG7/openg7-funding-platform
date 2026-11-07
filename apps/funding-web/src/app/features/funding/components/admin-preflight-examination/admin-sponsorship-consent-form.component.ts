import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import type {
  AdminSponsorshipConsent,
  AdminSponsorshipConsentRecordReceipt
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  consentAgreementDateIsValid,
  consentBusinessDate,
  type SponsorshipConsentIntent,
  type SponsorshipConsentNotice
} from '../../services/admin-sponsorship-consent-controller.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

/** Funding molecule: records a human's documented-agreement intent, with no HTTP or routing. */
@Component({
  selector: 'openg7-admin-sponsorship-consent-form',
  standalone: true,
  imports: [AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-consent-form.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsorship-consent-form.component.css'
  ]
})
export class AdminSponsorshipConsentFormComponent {
  readonly receipt = input<AdminSponsorshipConsent | null>(null);
  readonly result = input<AdminSponsorshipConsentRecordReceipt | null>(null);
  readonly busy = input(false);
  readonly loading = input(false);
  readonly readonly = input(false);
  readonly unresolved = input(false);
  readonly needsRefresh = input(false);
  readonly retryAllowed = input(false);
  readonly notice = input<SponsorshipConsentNotice | null>(null);
  readonly recordRequested = output<SponsorshipConsentIntent>();
  readonly refreshRequested = output<void>();
  readonly reconcileRequested = output<void>();
  readonly retryRequested = output<void>();
  readonly agreement = signal(false);
  readonly agreedOn = signal('');
  readonly evidence = signal('');
  readonly today = consentBusinessDate(new Date());
  readonly validDate = computed(() =>
    consentAgreementDateIsValid(this.agreedOn(), this.today)
  );
  readonly canSubmit = computed(
    () =>
      this.receipt()?.canRecord === true &&
      !this.readonly() &&
      !this.busy() &&
      !this.loading() &&
      !this.unresolved() &&
      !this.needsRefresh() &&
      !this.result() &&
      this.agreement() &&
      this.validDate() &&
      this.evidence().trim().length > 0 &&
      this.evidence().trim().length <= 1000
  );
  private readonly i18n = inject(FundingI18nService);
  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.preflightExamination.consent.' + key, params);
  }
  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
  submit(): void {
    if (this.canSubmit())
      this.recordRequested.emit({
        agreedOn: this.agreedOn(),
        evidenceReference: this.evidence().trim(),
        agreementReceived: true
      });
  }
  formatDate(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Toronto'
    }).format(new Date(value));
  }
}
