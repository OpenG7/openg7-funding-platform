import { Injectable } from '@angular/core';
import {
  CheckoutRequest,
  CheckoutResult,
  createMockCheckoutResult
} from '@openg7/funding-core';
import { FundingSnapshot } from '@openg7/funding-core';
import { FundingProjectConfig } from '@openg7/funding-models';

import { OPENG7_FUNDING_CONFIG } from '../config/openg7-funding.config.js';

@Injectable({ providedIn: 'root' })
export class FundingService {
  constructor(
    private readonly config: FundingProjectConfig = OPENG7_FUNDING_CONFIG
  ) {}

  readonly mockSnapshot: FundingSnapshot = {
    totals: {
      confirmedContributions: 145,
      transactionFees: 6,
      availableFunds: 139
    },
    allocation: [
      { category: 'Infrastructure ouverte', amount: 80 },
      { category: 'Outillage civique', amount: 40 },
      { category: 'Résilience interprovinciale', amount: 19 }
    ],
    contributors: [
      { id: 'a', displayName: 'Québec, QC', amount: 50, isAnonymous: false },
      { id: 'b', displayName: 'Anonyme', amount: 25, isAnonymous: true }
    ]
  };

  /**
   * Mock checkout bootstrap. This is intentionally non-production and does not call Stripe yet.
   */
  startCheckout(amount: number): Promise<CheckoutResult> {
    const request: CheckoutRequest = {
      amount,
      currency: 'CAD',
      projectId: this.config?.projectId ?? 'openg7'
    };

    return Promise.resolve(createMockCheckoutResult(request));
  }
}
