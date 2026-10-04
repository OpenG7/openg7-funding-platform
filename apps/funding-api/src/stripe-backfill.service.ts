import type { Pool } from 'pg';
import type Stripe from 'stripe';

import { backfillCheckoutSessions } from './stripe-backfill/checkout.js';
import type {
  StripeBackfillOptions,
  StripeBackfillSummary
} from './stripe-backfill/contracts.js';
import { backfillDisputes } from './stripe-backfill/disputes.js';
import { backfillPayouts } from './stripe-backfill/payouts.js';
import { assertBackfillSchema } from './stripe-backfill/repository.js';
import { emptySummary } from './stripe-backfill/summary.js';

export type {
  StripeBackfillCreatedRange,
  StripeBackfillOptions,
  StripeBackfillSummary
} from './stripe-backfill/contracts.js';

export const runStripeBackfill = async (
  stripe: Stripe,
  pool: Pool,
  options: StripeBackfillOptions
): Promise<StripeBackfillSummary> => {
  await assertBackfillSchema(pool);

  const summary = emptySummary(options);
  options.logger?.log(
    `Stripe backfill started for project ${options.projectId}${options.dryRun ? ' (dry run)' : ''}.`
  );

  await backfillCheckoutSessions(stripe, pool, options, summary);
  await backfillPayouts(stripe, pool, options, summary);
  await backfillDisputes(stripe, pool, options, summary);

  summary.finishedAt = new Date().toISOString();
  options.logger?.log('Stripe backfill completed.');

  return summary;
};
