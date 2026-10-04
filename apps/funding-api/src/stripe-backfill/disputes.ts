import type { Pool } from 'pg';
import type Stripe from 'stripe';

import { updateContributionStatusByPaymentIntent } from '../fund-contributions.repository.js';
import {
  resolveCharge,
  resolvePaymentIntent
} from '../stripe-object-normalization.js';
import { stripeMetadataProject } from '../stripe-project-scope.js';

import type {
  StripeBackfillOptions,
  StripeBackfillSummary
} from './contracts.js';
import { shouldStopAfterScan } from './shared.js';

const metadataMatchesProject = (
  metadata: Stripe.Metadata | null | undefined,
  projectId: string
): boolean => stripeMetadataProject(metadata, projectId) === true;

const buildDisputeListParams = (
  options: StripeBackfillOptions
): Stripe.DisputeListParams => ({
  limit: 100,
  expand: ['data.charge'],
  ...(options.created ? { created: options.created } : {})
});

const resolveDisputePaymentIntent = async (
  stripe: Stripe,
  dispute: Stripe.Dispute
): Promise<Stripe.PaymentIntent | null> => {
  const charge = await resolveCharge(stripe, dispute.charge, {
    expand: ['balance_transaction', 'payment_intent']
  });
  return resolvePaymentIntent(stripe, charge?.payment_intent);
};

export const backfillDisputes = async (
  stripe: Stripe,
  pool: Pool,
  options: StripeBackfillOptions,
  summary: StripeBackfillSummary
): Promise<void> => {
  if (!options.includeDisputes) {
    return;
  }

  for await (const dispute of stripe.disputes.list(
    buildDisputeListParams(options)
  )) {
    if (options.deadlineAt && Date.now() >= options.deadlineAt)
      throw new Error('Backfill time limit reached.');
    if (shouldStopAfterScan(summary.disputes.scanned, options.maxRecords)) {
      break;
    }

    summary.disputes.scanned += 1;

    const paymentIntent = await resolveDisputePaymentIntent(stripe, dispute);
    if (!paymentIntent) {
      continue;
    }

    const matches =
      options.includeUnmatched ||
      metadataMatchesProject(paymentIntent.metadata, options.projectId);

    if (!matches) {
      continue;
    }

    summary.disputes.matched += 1;

    if (options.dryRun) {
      summary.disputes.dryRunWouldUpdate += 1;
      continue;
    }

    const updated = await updateContributionStatusByPaymentIntent(pool, {
      stripePaymentIntentId: paymentIntent.id,
      status: 'disputed'
    });

    if (updated) {
      summary.disputes.statusUpdated += 1;
    }
  }
};
