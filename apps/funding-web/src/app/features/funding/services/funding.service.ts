import { Injectable, inject } from '@angular/core';
import {
  CheckoutConsentPayload,
  CheckoutRequest,
  CheckoutResult,
  ContributionType,
  PublicSponsorshipBatchAvailabilityResponse,
  SponsorshipDetailsResult,
  SponsorshipFollowupDetailsRequest,
  SponsorshipFollowupResponse,
  createMockCheckoutResult
} from '@openg7/funding-core';
import { FundingSnapshot } from '@openg7/funding-core';
import { FundingProjectConfig } from '@openg7/funding-models';

import { FUNDING_PROJECT_CONFIG } from '../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../config/openg7-funding.config.js';

@Injectable({ providedIn: 'root' })
export class FundingService {
  private readonly config: FundingProjectConfig =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;
  private readonly apiBaseUrl = this.resolveApiBaseUrl();

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
      cancelUrl: this.buildReturnUrl('cancel'),
      contributionType: consent.contributionType,
      publicDisplayConsent: consent.publicDisplayConsent,
      publicDisplayName: consent.publicDisplayName,
      displayAmountConsent: consent.displayAmountConsent,
      nonCharityAcknowledged: consent.nonCharityAcknowledged
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}/checkout-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        if (!this.canUseDevelopmentCheckoutFallback()) {
          throw new Error('Checkout API is unavailable.');
        }

        return createMockCheckoutResult(request);
      }

      const result = (await response.json()) as CheckoutResult;

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

  private buildReturnUrl(
    flow: 'success' | 'cancel',
    contributionType?: ContributionType
  ): string {
    if (typeof window === 'undefined') {
      return `https://example.org/funding/${flow}`;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('checkout', flow);

    if (flow !== 'success') {
      return url.toString();
    }

    if (contributionType) {
      url.searchParams.set('contributionType', contributionType);
    }

    return url.toString();
  }

  async getSponsorshipBatchAvailability(): Promise<PublicSponsorshipBatchAvailabilityResponse> {
    const response = await fetch(
      `${this.apiBaseUrl}/public/sponsorship-batches/availability`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Sponsorship batch availability could not be loaded.');
    }

    return (await response.json()) as PublicSponsorshipBatchAvailabilityResponse;
  }

  async getSponsorshipFollowup(
    token: string
  ): Promise<SponsorshipFollowupResponse> {
    const params = new URLSearchParams({ token });
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Sponsorship follow-up could not be loaded.');
    }

    return (await response.json()) as SponsorshipFollowupResponse;
  }

  async submitSponsorshipFollowupDetails(
    payload: SponsorshipFollowupDetailsRequest
  ): Promise<SponsorshipDetailsResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup/details`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        readonly error?: string;
      } | null;
      throw new Error(
        body?.error ?? 'Sponsorship follow-up details could not be submitted.'
      );
    }

    return (await response.json()) as SponsorshipDetailsResult;
  }

  private resolveApiBaseUrl(): string {
    const globalApiBaseUrl =
      typeof window !== 'undefined'
        ? (
            window as Window & {
              readonly __OPENG7_FUNDING_API_BASE_URL__?: string;
            }
          ).__OPENG7_FUNDING_API_BASE_URL__
        : undefined;

    return globalApiBaseUrl?.replace(/\/$/, '') ?? '/api';
  }

  private canUseDevelopmentCheckoutFallback(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    return ['localhost', '127.0.0.1'].includes(window.location.hostname);
  }
}
