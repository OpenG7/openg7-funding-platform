import type {
  CheckoutRequest,
  CheckoutResult,
  FundTransparencyPublicResponse,
  PublicBuildersResponse,
  PublicFundingRuntimeConfig,
  PublicReferenceLookupRequest,
  PublicReferenceLookupResponse,
  PublicSponsorshipBatchAvailabilityResponse,
  PublicSponsorshipsResponse,
  ReferenceRecoveryRequest,
  ReferenceRecoveryResult
} from '@openg7/funding-core';

import { CheckoutReconciliationRequiredError } from './checkout-error.js';

/** Public funding endpoints; checkout attempts and return URLs belong to FundingService. */
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
      if (response.status === 409) {
        const failure: unknown = await response.json().catch(() => null);
        if (
          typeof failure === 'object' &&
          failure !== null &&
          'code' in failure &&
          failure.code === 'CHECKOUT_RECONCILIATION_REQUIRED'
        ) {
          throw new CheckoutReconciliationRequiredError();
        }
      }
      throw new Error('Checkout API is unavailable.');
    }

    const result: unknown = await response.json();
    if (
      typeof result !== 'object' ||
      result === null ||
      !('status' in result) ||
      (result.status !== 'mocked' && result.status !== 'redirected') ||
      !('checkoutId' in result) ||
      typeof result.checkoutId !== 'string' ||
      result.checkoutId.length === 0 ||
      !('redirectUrl' in result) ||
      typeof result.redirectUrl !== 'string' ||
      result.redirectUrl.length === 0
    ) {
      throw new Error('Checkout API returned an invalid response.');
    }
    return result as CheckoutResult;
  }

  async getPublicFundingConfig(): Promise<PublicFundingRuntimeConfig> {
    return this.getPublicData(
      '/public/funding-config',
      'Funding runtime config could not be loaded.'
    );
  }

  async getPublicBuilders(
    page: number,
    pageSize: number,
    signal?: AbortSignal
  ): Promise<PublicBuildersResponse> {
    const params = this.paginationParams(page, pageSize);
    return this.getPublicData(
      `/public/builders?${params}`,
      'Failed to load public builders',
      { signal }
    );
  }

  async getPublicTransparency(
    signal?: AbortSignal
  ): Promise<FundTransparencyPublicResponse> {
    return this.getPublicData(
      '/public/fund-transparency',
      'Failed to load public transparency data',
      { method: 'GET', signal }
    );
  }

  async getPublicSponsorshipPage(
    page: number,
    pageSize: number,
    signal?: AbortSignal
  ): Promise<PublicSponsorshipsResponse> {
    return this.getPublicSponsorships(
      signal,
      this.paginationParams(page, pageSize)
    );
  }

  async getPublicSponsorships(
    signal?: AbortSignal,
    params?: URLSearchParams
  ): Promise<PublicSponsorshipsResponse> {
    return this.getPublicData(
      `/public/sponsorships${params ? '?' + params : ''}`,
      'Failed to load public sponsorship data',
      { method: 'GET', signal }
    );
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
    return this.getPublicData(
      '/public/sponsorship-batches/availability',
      'Sponsorship batch availability could not be loaded.'
    );
  }

  private paginationParams(page: number, pageSize: number): URLSearchParams {
    return new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
  }

  private async getPublicData<T>(
    path: string,
    fallback: string,
    options: { readonly method?: 'GET'; readonly signal?: AbortSignal } = {
      method: 'GET'
    }
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...options,
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(fallback);
    }

    return (await response.json()) as T;
  }
}
