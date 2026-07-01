import { Injectable, inject } from '@angular/core';
import {
  CheckoutRequest,
  CheckoutResult,
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
   * Creates a checkout session via the local API and falls back to a mock result if the API is unavailable.
   */
  async startCheckout(amount: number): Promise<CheckoutResult> {
    const request: CheckoutRequest = {
      amount,
      currency: 'CAD',
      projectId: this.config?.projectId ?? 'openg7',
      successUrl: this.buildReturnUrl('success'),
      cancelUrl: this.buildReturnUrl('cancel')
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
        return createMockCheckoutResult(request);
      }

      return (await response.json()) as CheckoutResult;
    } catch {
      return createMockCheckoutResult(request);
    }
  }

  private buildReturnUrl(flow: 'success' | 'cancel'): string {
    if (typeof window === 'undefined') {
      return `https://example.org/funding/${flow}`;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('checkout', flow);
    return url.toString();
  }

  private resolveApiBaseUrl(): string {
    const globalApiBaseUrl =
      typeof window !== 'undefined'
        ? (window as Window & {
            readonly __OPENG7_FUNDING_API_BASE_URL__?: string;
          }).__OPENG7_FUNDING_API_BASE_URL__
        : undefined;

    return globalApiBaseUrl?.replace(/\/$/, '') ?? '/api';
  }
}
