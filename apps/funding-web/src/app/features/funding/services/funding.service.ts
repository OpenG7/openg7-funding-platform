import { Injectable, inject } from '@angular/core';
import {
  CheckoutConsentPayload,
  CheckoutResult,
  ContributionType,
  PublicFundingRuntimeConfig,
  PublicReferenceLookupRequest,
  PublicReferenceLookupResponse,
  PublicSponsorshipBatchAvailabilityResponse,
  ReferenceRecoveryRequest,
  ReferenceRecoveryResult,
  SponsorMediaDeleteRequest,
  SponsorMediaDeleteResult,
  SponsorMediaKind,
  SponsorMediaUploadResult,
  SponsorshipDetailsResult,
  SponsorshipFollowupDetailsRequest,
  SponsorshipFollowupResponse,
  SponsorshipMediaResponse,
  SponsorshipOfferQuote
} from '@openg7/funding-core';
import { FundingProjectConfig } from '@openg7/funding-models';

import { FUNDING_PROJECT_CONFIG } from '../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../config/openg7-funding.config.js';

import { CheckoutAttempts } from './checkout-attempts.js';
import {
  CheckoutReconciliationRequiredError,
  CheckoutRecoveryUnavailableError,
  CheckoutCharterChangedError,
  CheckoutOfferChangedError
} from './checkout-error.js';
import { resolveFundingApiBaseUrl } from './funding-api-base-url.js';
import { FundingPublicClient } from './funding-public.client.js';
import { FundingSponsorshipFollowupClient } from './funding-sponsorship-followup.client.js';

@Injectable({ providedIn: 'root' })
export class FundingService {
  private readonly config: FundingProjectConfig =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;
  private readonly apiBaseUrl = resolveFundingApiBaseUrl();
  private readonly publicClient = new FundingPublicClient(this.apiBaseUrl);
  private readonly checkoutAttempts = new CheckoutAttempts(
    () => (typeof window === 'undefined' ? null : window.localStorage),
    () => (typeof window === 'undefined' ? null : window.sessionStorage)
  );
  private readonly followupClient = new FundingSponsorshipFollowupClient(
    this.apiBaseUrl
  );

  requiresCheckoutVerification(): boolean {
    return this.checkoutAttempts.requiresVerification();
  }

  restoreCheckoutVerification(): Promise<boolean> {
    return this.checkoutAttempts.restoreVerification();
  }

  /**
   * Creates a checkout via the API, retaining the same key after an uncertain response.
   */
  async startCheckout(
    amount: number,
    consent: CheckoutConsentPayload,
    offerQuote?: SponsorshipOfferQuote
  ): Promise<CheckoutResult> {
    const request = {
      amount,
      currency: 'CAD' as const,
      projectId: this.config?.projectId ?? 'openg7',
      successUrl: this.buildReturnUrl('success', consent.contributionType),
      cancelUrl: this.buildReturnUrl('cancel', consent.contributionType),
      contributionType: consent.contributionType,
      publicDisplayConsent: consent.publicDisplayConsent,
      publicDisplayName: consent.publicDisplayName,
      displayAmountConsent: consent.displayAmountConsent,
      nonCharityAcknowledged: consent.nonCharityAcknowledged,
      ...(consent.charterAcceptance
        ? { charterAcceptance: consent.charterAcceptance }
        : {}),
      ...(consent.contributionType === 'sponsorship_interest' &&
      consent.offerAcceptance
        ? { offerAcceptance: consent.offerAcceptance }
        : {}),
      ...(consent.contributionType === 'sponsorship_interest' &&
      consent.offerFormats
        ? { offerFormats: consent.offerFormats }
        : {})
    };

    try {
      return await this.checkoutAttempts.start(
        request,
        async (attempt) => {
          const result = await this.publicClient.startCheckout(attempt);
          if (
            result.status === 'mocked' &&
            !this.canUseDevelopmentCheckoutFallback()
          ) {
            throw new Error(
              'Mock checkout is disabled outside local development.'
            );
          }
          return result;
        },
        offerQuote
      );
    } catch (error) {
      if (
        error instanceof CheckoutReconciliationRequiredError ||
        error instanceof CheckoutRecoveryUnavailableError ||
        error instanceof CheckoutCharterChangedError ||
        error instanceof CheckoutOfferChangedError
      )
        throw error;
      throw new Error('Checkout could not be started.');
    }
  }

  async getPublicFundingConfig(): Promise<PublicFundingRuntimeConfig> {
    return this.publicClient.getPublicFundingConfig();
  }
  getSponsorshipCharter() {
    return this.publicClient.sponsorshipCharter();
  }
  getSponsorshipOffer(
    amountMinor: number,
    currency: string,
    signal?: AbortSignal,
    formats?: import('@openg7/funding-core').SponsorshipOfferFormatOptions
  ) {
    return this.publicClient.sponsorshipOffer(
      amountMinor,
      currency,
      signal,
      formats
    );
  }
  getRetainedSponsorshipOffer(amountMinor: number, currency: string) {
    return this.checkoutAttempts.retainedSponsorshipOffer(
      amountMinor,
      currency
    );
  }
  getSponsorshipModeration(token: string) {
    return this.followupClient.moderation(token);
  }
  requestSponsorshipReconsideration(
    payload: import('@openg7/funding-core').SponsorshipReconsiderationRequest
  ) {
    return this.followupClient.reconsideration(payload);
  }
  submitSponsorshipCorrection(
    payload: import('@openg7/funding-core').SponsorshipCorrectionRequest
  ) {
    return this.followupClient.correction(payload);
  }

  async lookupPublicReference(
    payload: PublicReferenceLookupRequest,
    signal?: AbortSignal
  ): Promise<PublicReferenceLookupResponse> {
    return this.publicClient.lookupPublicReference(payload, signal);
  }

  async requestContributionReferenceRecovery(
    payload: ReferenceRecoveryRequest,
    signal?: AbortSignal
  ): Promise<ReferenceRecoveryResult> {
    return this.publicClient.requestContributionReferenceRecovery(
      payload,
      signal
    );
  }

  private buildReturnUrl(
    flow: 'success' | 'cancel',
    contributionType?: ContributionType
  ): string {
    if (typeof window === 'undefined') {
      return `https://example.org/funding/${flow}`;
    }

    const url = new URL(window.location.href);
    for (const key of [
      'reference',
      'session_id',
      'followup_token',
      'contributionType'
    ]) {
      url.searchParams.delete(key);
    }
    url.searchParams.set('checkout', flow);
    url.searchParams.set(
      'intent',
      contributionType === 'sponsorship_interest' ? 'sponsorship' : 'personal'
    );
    if (contributionType) {
      url.searchParams.set('contributionType', contributionType);
    }

    return url.toString();
  }

  async getSponsorshipBatchAvailability(): Promise<PublicSponsorshipBatchAvailabilityResponse> {
    return this.publicClient.getSponsorshipBatchAvailability();
  }

  async getSponsorshipFollowup(
    token: string
  ): Promise<SponsorshipFollowupResponse> {
    return this.followupClient.getSponsorshipFollowup(token);
  }

  async requestSponsorshipAccess(
    email: string,
    locale: 'fr-CA' | 'en',
    signal?: AbortSignal
  ): Promise<void> {
    return this.followupClient.requestSponsorshipAccess(email, locale, signal);
  }

  async getSponsorshipDraft(
    token: string
  ): Promise<import('@openg7/funding-core').SponsorshipDraftSnapshot> {
    return this.followupClient.getSponsorshipDraft(token);
  }

  async saveSponsorshipDraft(
    payload: import('@openg7/funding-core').SponsorshipDraftRequest
  ): Promise<import('@openg7/funding-core').SponsorshipDraftSnapshot> {
    return this.followupClient.saveSponsorshipDraft(payload);
  }

  async submitSponsorshipFollowupDetails(
    payload: SponsorshipFollowupDetailsRequest
  ): Promise<SponsorshipDetailsResult> {
    return this.followupClient.submitSponsorshipFollowupDetails(payload);
  }

  async getSponsorshipMedia(token: string): Promise<SponsorshipMediaResponse> {
    return this.followupClient.getSponsorshipMedia(token);
  }

  async getSponsorshipMediaPreview(
    token: string,
    assetId: string
  ): Promise<Blob> {
    return this.followupClient.getSponsorshipMediaPreview(token, assetId);
  }

  async uploadSponsorshipMedia(
    token: string,
    kind: SponsorMediaKind,
    file: File,
    altText?: string,
    usage?: import('@openg7/funding-core').SponsorMediaUsageRights
  ): Promise<SponsorMediaUploadResult> {
    return this.followupClient.uploadSponsorshipMedia(
      token,
      kind,
      file,
      altText,
      usage
    );
  }

  async deleteSponsorshipMedia(
    payload: SponsorMediaDeleteRequest
  ): Promise<SponsorMediaDeleteResult> {
    return this.followupClient.deleteSponsorshipMedia(payload);
  }
  updateSponsorshipMediaUsage(
    payload: import('@openg7/funding-core').SponsorMediaUsageRequest
  ) {
    return this.followupClient.updateSponsorshipMediaUsage(payload);
  }
  requestSponsorshipMediaPreference(
    payload: import('@openg7/funding-core').SponsorMediaPreferenceRequest
  ) {
    return this.followupClient.requestSponsorshipMediaPreference(payload);
  }

  private canUseDevelopmentCheckoutFallback(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    return ['localhost', '127.0.0.1'].includes(window.location.hostname);
  }
}
