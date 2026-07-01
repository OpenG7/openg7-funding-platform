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
