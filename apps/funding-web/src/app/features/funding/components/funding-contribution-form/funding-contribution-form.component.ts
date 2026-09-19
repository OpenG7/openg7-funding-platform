import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnChanges,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  isValidSponsorshipAmount,
  resolveSponsorshipBenefits
} from '@openg7/funding-core';
import type {
  CheckoutConsentPayload,
  ContributionType,
  PublicSponsorshipBatchAvailabilityResponse,
  SponsorFeedChannel,
  SponsorshipBenefitId
} from '@openg7/funding-core';

import { FUNDING_PROJECT_CONFIG } from '../../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../../config/openg7-funding.config.js';
import { parseContributionMinor } from '../../models/funding-home.utils.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

export interface FundingContributionSubmission {
  readonly amount: number;
  readonly consent: CheckoutConsentPayload;
}

/** Funding organism: contribution choices and consent; checkout stays with the page. */
@Component({
  selector: 'openg7-funding-contribution-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-contribution-form.component.html',
  styles: [':host { display: block; min-width: 0; }']
})
export class FundingContributionFormComponent implements OnChanges {
  private readonly i18n = inject(FundingI18nService);
  readonly config =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;
  readonly sponsorshipSelectionEnabled = input(false);
  readonly requestedContributionType =
    input<ContributionType>('personal_support');
  private requestedTypeApplied = false;
  private typeChosenByVisitor = false;
  readonly allowedAmounts = input<readonly number[]>(
    this.config.contributionAmounts
  );
  readonly sponsorshipBatchAvailability =
    input<PublicSponsorshipBatchAvailabilityResponse | null>(null);
  readonly loadingState = input<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  readonly checkoutResultMode = input<'mocked' | null>(null);
  readonly contributionSubmitted = output<FundingContributionSubmission>();
  readonly policyPath = computed(() =>
    this.i18n.localizedPath('/politique-utilisation-remboursement')
  );
  readonly activeAmountPresets = computed<readonly number[]>(() =>
    this.contributionType() === 'sponsorship_interest'
      ? this.config.sponsorship.presetAmounts
      : this.allowedAmounts()
  );
  readonly selectedContributionAmount = signal<number>(
    this.config.contributionAmounts[2] ?? this.config.contributionAmounts[0]
  );
  readonly customContributionValue = signal<string>('');
  readonly contributionType = signal<ContributionType>('personal_support');
  readonly publicDisplayConsent = signal<boolean>(false);
  readonly publicDisplayName = signal<string>('');
  readonly displayAmountConsent = signal<boolean>(false);
  readonly nonCharityAcknowledged = signal<boolean>(false);
  readonly effectiveAmount = computed<number | null>(() =>
    this.customContributionValue().length > 0
      ? this.parseCustomContributionAmount(this.customContributionValue())
      : this.selectedContributionAmount()
  );
  readonly hasInvalidCustomContribution = computed(
    () => !this.isAllowedAmount(this.effectiveAmount())
  );
  readonly canStartCheckout = computed(
    () =>
      this.nonCharityAcknowledged() &&
      this.loadingState() !== 'loading' &&
      !this.hasInvalidCustomContribution() &&
      (this.contributionType() !== 'sponsorship_interest' ||
        this.sponsorshipSelectionEnabled()) &&
      (!this.publicDisplayConsent() ||
        this.publicDisplayName().trim().length > 0)
  );
  readonly allowedAmountsLabel = computed(() =>
    this.allowedAmounts()
      .map((amount) => this.formatMoney(amount))
      .join(', ')
  );
  readonly customContributionHelpKey = computed(() => {
    const value = this.customContributionValue();
    if (value.length > 0 && this.parseCustomContributionAmount(value) === null)
      return 'funding.home.contribution.amountFormatError';
    if (this.contributionType() === 'personal_support')
      return 'funding.home.contribution.personalAmountHint';
    return this.hasInvalidCustomContribution()
      ? 'funding.home.contribution.sponsorship.minimumAmountError'
      : 'funding.home.contribution.amountFormatHint';
  });
  readonly sponsorshipBenefits = computed(() =>
    resolveSponsorshipBenefits(
      this.effectiveAmount() ?? 0,
      this.config.sponsorship
    )
  );

  readonly sponsorshipBenefitLabelKeys: Readonly<
    Record<SponsorshipBenefitId, string>
  > = {
    website_mention: 'funding.home.contribution.sponsorship.benefits.openg7',
    facebook_batch: 'funding.home.contribution.sponsorship.benefits.facebook',
    linkedin_batch: 'funding.home.contribution.sponsorship.benefits.linkedin'
  };

  readonly sponsorshipUpcomingLabelKeys: Readonly<
    Record<SponsorshipBenefitId, string>
  > = {
    website_mention: 'funding.home.contribution.sponsorship.upcoming.openg7',
    facebook_batch: 'funding.home.contribution.sponsorship.upcoming.facebook',
    linkedin_batch: 'funding.home.contribution.sponsorship.upcoming.linkedin'
  };

  readonly sponsorshipAvailabilityLabelKeys: Readonly<
    Record<SponsorFeedChannel, string>
  > = {
    facebook: 'funding.home.contribution.sponsorship.availability.facebook',
    linkedin: 'funding.home.contribution.sponsorship.availability.linkedin'
  };

  readonly sponsorshipAvailabilityEntries = computed<
    readonly { readonly channel: SponsorFeedChannel; readonly date: string }[]
  >(() =>
    (this.sponsorshipBatchAvailability()?.availability ?? [])
      .filter(
        (
          entry
        ): entry is { channel: SponsorFeedChannel; nextAvailableAt: string } =>
          entry.nextAvailableAt !== null
      )
      .map((entry) => ({
        channel: entry.channel,
        date: this.formatDateOnly(entry.nextAvailableAt)
      }))
  );
  ngOnChanges(): void {
    if (
      !this.requestedTypeApplied &&
      !this.typeChosenByVisitor &&
      this.requestedContributionType() === 'sponsorship_interest' &&
      this.sponsorshipSelectionEnabled()
    ) {
      this.contributionType.set('sponsorship_interest');
      this.requestedTypeApplied = true;
    }
    if (
      !this.sponsorshipSelectionEnabled() &&
      this.contributionType() === 'sponsorship_interest'
    )
      this.contributionType.set('personal_support');
    this.reconcilePreset();
  }
  private isAllowedAmount(amount: number | null): boolean {
    if (amount === null || parseContributionMinor(String(amount)) === null)
      return false;
    return this.contributionType() === 'sponsorship_interest'
      ? isValidSponsorshipAmount(amount, this.config.sponsorship)
      : this.allowedAmounts().includes(amount);
  }
  private reconcilePreset(): void {
    if (
      !this.customContributionValue() &&
      !this.isAllowedAmount(this.selectedContributionAmount())
    ) {
      this.selectedContributionAmount.set(this.activeAmountPresets()[0] ?? 0);
    }
  }
  setContributionType(type: ContributionType): void {
    if (type === 'sponsorship_interest' && !this.sponsorshipSelectionEnabled())
      return;
    this.typeChosenByVisitor = true;
    this.contributionType.set(type);
    this.reconcilePreset();
  }
  setContributionAmount(amount: number): void {
    this.customContributionValue.set('');
    this.selectedContributionAmount.set(amount);
  }
  setCustomContributionFromEvent(event: Event): void {
    this.customContributionValue.set(this.valueFromEvent(event));
  }
  normalizeCustomContributionFromEvent(event: Event): void {
    const amount = this.parseCustomContributionAmount(
      this.customContributionValue()
    );
    if (amount === null) return;
    const value = new Intl.NumberFormat(this.i18n.currentLanguage(), {
      useGrouping: false,
      maximumFractionDigits: 2
    }).format(amount);
    this.customContributionValue.set(value);
    (event.target as HTMLInputElement).value = value;
  }
  isSelectedAmount(amount: number): boolean {
    return this.effectiveAmount() === amount;
  }
  setPublicDisplayConsent(event: Event): void {
    this.publicDisplayConsent.set(this.checkedFromEvent(event));
  }

  setPublicDisplayName(event: Event): void {
    this.publicDisplayName.set(this.valueFromEvent(event));
  }

  setDisplayAmountConsent(event: Event): void {
    this.displayAmountConsent.set(this.checkedFromEvent(event));
  }

  setNonCharityAcknowledged(event: Event): void {
    this.nonCharityAcknowledged.set(this.checkedFromEvent(event));
  }
  formatMoney(amount: number): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: this.config.currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  }
  private formatDateOnly(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'long'
    }).format(new Date(value));
  }
  submitContribution(): void {
    const amount = this.effectiveAmount();
    if (!this.canStartCheckout() || amount === null) return;
    this.contributionSubmitted.emit({
      amount,
      consent: {
        contributionType: this.contributionType(),
        publicDisplayConsent: this.publicDisplayConsent(),
        publicDisplayName: this.publicDisplayConsent()
          ? this.publicDisplayName().trim()
          : undefined,
        displayAmountConsent: this.displayAmountConsent(),
        nonCharityAcknowledged: this.nonCharityAcknowledged()
      }
    });
  }
  private checkedFromEvent(event: Event): boolean {
    return Boolean((event.target as HTMLInputElement | null)?.checked);
  }

  private valueFromEvent(event: Event): string {
    return (
      (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ??
      ''
    );
  }
  private parseCustomContributionAmount(value: string): number | null {
    const minor = parseContributionMinor(value);
    return minor === null ? null : minor / 100;
  }
}
