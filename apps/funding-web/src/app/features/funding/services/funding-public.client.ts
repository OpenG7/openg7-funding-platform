import type {
  CheckoutRequest,
  CheckoutResult,
  PublicFundingRuntimeConfig,
  PublicReferenceLookupRequest,
  PublicReferenceLookupResponse,
  PublicSponsorshipBatchAvailabilityResponse,
  ReferenceRecoveryRequest,
  ReferenceRecoveryResult
} from '@openg7/funding-core';

/** Public funding endpoints; checkout return URLs and local fallback belong to FundingService. */
export class FundingPublicClient {
  constructor(private readonly apiBaseUrl: string) {}

  async startCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const response = await fetch(`${this.apiBaseUrl}/checkout-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error('Checkout API is unavailable.');
    }

    return (await response.json()) as CheckoutResult;
  }

  async getPublicFundingConfig(): Promise<PublicFundingRuntimeConfig> {
    const response = await fetch(`${this.apiBaseUrl}/public/funding-config`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Funding runtime config could not be loaded.');
    }

    return (await response.json()) as PublicFundingRuntimeConfig;
  }

  async lookupPublicReference(
    payload: PublicReferenceLookupRequest,
    signal?: AbortSignal
  ): Promise<PublicReferenceLookupResponse> {
    const response = await fetch(`${this.apiBaseUrl}/reference-lookup`, {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('OpenG7 reference lookup could not be completed.');
    }

    return (await response.json()) as PublicReferenceLookupResponse;
  }

  async requestContributionReferenceRecovery(
    payload: ReferenceRecoveryRequest,
    signal?: AbortSignal
  ): Promise<ReferenceRecoveryResult> {
    const response = await fetch(`${this.apiBaseUrl}/reference-recovery`, {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Reference recovery could not be requested.');
    }

    const result = (await response.json()) as ReferenceRecoveryResult;
    if (result.accepted !== true) {
      throw new Error('Reference recovery was not accepted.');
    }
    return result;
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
}
