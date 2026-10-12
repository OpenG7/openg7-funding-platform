import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnChanges,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  isValidSponsorshipAmount,
  normalizeSponsorshipOfferFormats,
  publicationFormatCapability
} from '@openg7/funding-core';
import type {
  CheckoutConsentPayload,
  ContributionType,
  PublicSponsorshipBatchAvailabilityResponse,
  SponsorFeedChannel,
  SponsorshipOfferQuote,
  SponsorshipOfferFormatOptions,
  SponsorshipPublicationFormat
} from '@openg7/funding-core';

import { FUNDING_PROJECT_CONFIG } from '../../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../../config/openg7-funding.config.js';
import { parseContributionMinor } from '../../models/funding-home.utils.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { SponsorshipCharterService } from '../../services/sponsorship-charter.service.js';
import { SponsorshipOfferController } from '../../services/sponsorship-offer-controller.js';
import { FundingService } from '../../services/funding.service.js';
import { SponsorshipOfferSummaryComponent } from '../sponsorship-offer-summary/sponsorship-offer-summary.component.js';

export interface FundingContributionSubmission {
  readonly amount: number;
  readonly consent: CheckoutConsentPayload;
  readonly offerQuote?: SponsorshipOfferQuote;
}

/** Funding organism: contribution choices and consent; checkout stays with the page. */
@Component({
  selector: 'openg7-funding-contribution-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslatePipe,
    SponsorshipOfferSummaryComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-contribution-form.component.html',
  styleUrl: './funding-contribution-form.component.css',
  styles: [':host { display: block; min-width: 0; }']
})
export class FundingContributionFormComponent implements OnChanges {
  readonly charter = inject(SponsorshipCharterService);
  readonly charterAccepted = signal(false);
  private readonly funding = inject(FundingService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly offer = new SponsorshipOfferController({
    quote: (amountMinor, currency, signal, formats) =>
      this.funding.getSponsorshipOffer(amountMinor, currency, signal, formats),
    resume: (amountMinor, currency) =>
      this.funding.getRetainedSponsorshipOffer(amountMinor, currency)
  });
  constructor() {
    effect(() => {
      this.charter.charter();
      this.i18n.currentLanguage();
      this.charterAccepted.set(false);
    });
    effect(() => {
      if (this.checkoutCharterChanged()) void this.charter.load();
    });
    effect(() => {
      const amountMinor =
        this.contributionType() === 'sponsorship_interest' &&
        this.sponsorshipSelectionEnabled() &&
        !this.hasInvalidCustomContribution()
          ? this.effectiveAmountMinor()
          : null;
      const formats = this.offerFormats();
      untracked(() => {
        if (this.browser)
          void this.offer.load(
            amountMinor,
            this.config.currency,
            false,
            formats
          );
      });
    });
    effect(() => {
      if (this.checkoutOfferChanged()) {
        const amountMinor = this.effectiveAmountMinor();
        untracked(() => {
          if (this.browser)
            void this.offer.load(
              amountMinor,
              this.config.currency,
              true,
              this.offerFormats()
            );
        });
      }
    });
    effect(() => {
      this.i18n.currentLanguage();
      untracked(() => this.offer.accept(false));
    });
    inject(DestroyRef).onDestroy(() => this.offer.dispose());
  }
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
  readonly checkoutRequiresVerification = input(false);
  readonly checkoutCharterChanged = input(false);
  readonly checkoutOfferChanged = input(false);
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
  readonly offerFormats = signal<SponsorshipOfferFormatOptions | undefined>(
    undefined
  );
  readonly formatChannels = ['facebook', 'linkedin'] as const;
  readonly formats: readonly SponsorshipPublicationFormat[] = [
    'collective_text',
    'individual_portrait',
    'collective_composite',
    'image_collection'
  ];
  readonly formatsMatch = computed(
    () =>
      JSON.stringify(this.offerFormats()) ===
      JSON.stringify(this.offer.formats())
  );
  formatAvailable(channel: string, format: string): boolean {
    return publicationFormatCapability(channel, format).available;
  }
  selectFormat(channel: 'facebook' | 'linkedin', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '') {
      const formats = { ...this.offerFormats() };
      delete formats[channel];
      this.offerFormats.set(normalizeSponsorshipOfferFormats(formats));
      return;
    }
    if (!this.formatAvailable(channel, value)) return;
    this.offerFormats.set(
      normalizeSponsorshipOfferFormats({
        ...this.offerFormats(),
        [channel]: value
      })
    );
  }
  resetFormats(): void {
    if (!this.offer.retained()) this.offerFormats.set(undefined);
  }
  restoreRetainedOffer(): void {
    const quote = this.offer.quote();
    if (!quote || !this.offer.retained()) return;
    this.offerFormats.set(this.offer.formats());
    this.setContributionAmount(quote.amountMinor / 100);
  }
  readonly effectiveAmount = computed<number | null>(() =>
    this.customContributionValue().length > 0
      ? this.parseCustomContributionAmount(this.customContributionValue())
      : this.selectedContributionAmount()
  );
  readonly effectiveAmountMinor = computed(() => {
    const amount = this.effectiveAmount();
    return amount === null ? null : parseContributionMinor(String(amount));
  });
  readonly hasInvalidCustomContribution = computed(
    () => !this.isAllowedAmount(this.effectiveAmount())
  );
  readonly canStartCheckout = computed(
    () =>
      this.nonCharityAcknowledged() &&
      (this.contributionType() !== 'sponsorship_interest' ||
        (this.charter.state() === 'ready' &&
          (!this.charter.charter()?.active || this.charterAccepted()) &&
          this.offer.ready() &&
          this.formatsMatch() &&
          this.offer.quote()?.amountMinor === this.effectiveAmountMinor())) &&
      !this.checkoutRequiresVerification() &&
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
      ...(this.contributionType() === 'sponsorship_interest'
        ? { offerQuote: this.offer.quote()! }
        : {}),
      consent: {
        contributionType: this.contributionType(),
        publicDisplayConsent: this.publicDisplayConsent(),
        publicDisplayName: this.publicDisplayConsent()
          ? this.publicDisplayName().trim()
          : undefined,
        displayAmountConsent: this.displayAmountConsent(),
        nonCharityAcknowledged: this.nonCharityAcknowledged(),
        ...(this.contributionType() === 'sponsorship_interest'
          ? {
              offerAcceptance: {
                version: this.offer.quote()!.version,
                fingerprint: this.offer.quote()!.fingerprint
              },
              ...(this.offerFormats()
                ? { offerFormats: this.offerFormats() }
                : {})
            }
          : {}),
        ...(this.contributionType() === 'sponsorship_interest' &&
        this.charter.charter()?.active &&
        this.charterAccepted()
          ? {
              charterAcceptance: {
                accepted: true as const,
                policyVersion: this.charter.charter()!.policyVersion,
                fingerprint: this.charter.charter()!.fingerprint!,
                locale:
                  this.i18n.currentLanguage() === 'en'
                    ? ('en' as const)
                    : ('fr-CA' as const)
              }
            }
          : {})
      }
    });
  }
  private checkedFromEvent(event: Event): boolean {
    return Boolean((event.target as HTMLInputElement | null)?.checked);
  }
  acceptCharter(event: Event): void {
    this.charterAccepted.set(this.checkedFromEvent(event));
  }
  acceptOffer(event: Event): void {
    this.offer.accept(this.checkedFromEvent(event));
  }
  reloadOffer(): void {
    if (this.browser)
      void this.offer.load(
        this.effectiveAmountMinor(),
        this.config.currency,
        false,
        this.offerFormats()
      );
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
