import type { FundTransparencyPublicResponse } from '@openg7/funding-core';
import type Stripe from 'stripe';

import { collectStripeTransparencyFacts } from './stripe-transparency/collection.js';
import type { StripeTransparencyOptions } from './stripe-transparency/contracts.js';
import { projectStripeTransparency } from './stripe-transparency/projection.js';

export const getStripePublicTransparencySummary = async (
  stripe: Stripe,
  options: StripeTransparencyOptions
): Promise<FundTransparencyPublicResponse> => {
  const generatedAt = new Date().toISOString();
  return projectStripeTransparency(
    collectStripeTransparencyFacts(stripe, options),
    generatedAt
  );
};
