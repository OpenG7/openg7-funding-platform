import { Injectable, inject } from '@angular/core';
import {
  CheckoutConsentPayload,
  CheckoutRequest,
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
  createMockCheckoutResult
} from '@openg7/funding-core';
import { FundingSnapshot } from '@openg7/funding-core';
import { FundingProjectConfig } from '@openg7/funding-models';

import { FUNDING_PROJECT_CONFIG } from '../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../config/openg7-funding.config.js';

import { resolveFundingApiBaseUrl } from './funding-api-base-url.js';
import { FundingPublicClient } from './funding-public.client.js';
import { FundingSponsorshipFollowupClient } from './funding-sponsorship-followup.client.js';

@Injectable({ providedIn: 'root' })
export class FundingService {
  private readonly config: FundingProjectConfig =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;
  private readonly apiBaseUrl = resolveFundingApiBaseUrl();
  private readonly publicClient = new FundingPublicClient(this.apiBaseUrl);
  private readonly followupClient = new FundingSponsorshipFollowupClient(
    this.apiBaseUrl
  );

  readonly mockSnapshot: FundingSnapshot = {
    totals: {
      confirmedContributions: 184,
      transactionFees: -5.32,
      availableFunds: 178.68
    },
    allocation: [
      { category: 'Innovation civique', amount: 40 },
      { category: 'Infrastructure', amount: 30 },
      { category: 'Donnees ouvertes', amount: 20 },
      { category: 'Communaute', amount: 10 }
    ],
    contributors: [
      { id: 'a', displayName: 'Alexandre B.', amount: 25, isAnonymous: false },
      { id: 'b', displayName: 'Marie L.', amount: 10, isAnonymous: false },
      { id: 'c', displayName: 'Un batisseur', amount: 5, isAnonymous: true },
      { id: 'd', displayName: 'Sophie T.', amount: 25, isAnonymous: false }
    ]
  };

  /**
   * Creates a checkout session via the API. Mock fallback is limited to local development.
   */
  async startCheckout(
    amount: number,
    consent: CheckoutConsentPayload
  ): Promise<CheckoutResult> {
    const request: CheckoutRequest = {
      amount,
      currency: 'CAD',
      projectId: this.config?.projectId ?? 'openg7',
      successUrl: this.buildReturnUrl('success', consent.contributionType),
      cancelUrl: this.buildReturnUrl('cancel', consent.contributionType),
      contributionType: consent.contributionType,
      publicDisplayConsent: consent.publicDisplayConsent,
      publicDisplayName: consent.publicDisplayName,
      displayAmountConsent: consent.displayAmountConsent,
      nonCharityAcknowledged: consent.nonCharityAcknowledged
    };

    try {
      const result = await this.publicClient.startCheckout(request);

      if (
        result.status === 'mocked' &&
        !this.canUseDevelopmentCheckoutFallback()
      ) {
        throw new Error('Mock checkout is disabled outside local development.');
      }

      return result;
    } catch {
      if (!this.canUseDevelopmentCheckoutFallback()) {
        throw new Error('Checkout could not be started.');
      }

      return createMockCheckoutResult(request);
    }
  }

  async getPublicFundingConfig(): Promise<PublicFundingRuntimeConfig> {
    return this.publicClient.getPublicFundingConfig();
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
    altText?: string
  ): Promise<SponsorMediaUploadResult> {
    return this.followupClient.uploadSponsorshipMedia(
      token,
      kind,
      file,
      altText
    );
  }

  async deleteSponsorshipMedia(
    payload: SponsorMediaDeleteRequest
  ): Promise<SponsorMediaDeleteResult> {
    return this.followupClient.deleteSponsorshipMedia(payload);
  }

  private canUseDevelopmentCheckoutFallback(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    return ['localhost', '127.0.0.1'].includes(window.location.hostname);
  }
}
