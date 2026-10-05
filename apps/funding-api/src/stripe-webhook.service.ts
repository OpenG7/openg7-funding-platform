import type Stripe from 'stripe';
import type { Pool } from 'pg';

import { withStripeEventProcessing } from './stripe-events.repository.js';
import { stripeEventBelongsToProject } from './stripe-project-scope.js';
import { handleStripeCheckoutEvent } from './stripe-webhook/checkout-handlers.js';
import { handleStripeFinancialEvent } from './stripe-webhook/financial-handlers.js';

interface ProcessWebhookDependencies {
  readonly stripe: Stripe;
  readonly webhookSecret: string;
  readonly pool: Pool | null;
  readonly publicBaseUrl: string;
  readonly projectId: string;
}

const allowedEvents = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.updated',
  'charge.refunded',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'payout.paid',
  'payout.failed'
]);

const processVerifiedStripeEvent = async (
  event: Stripe.Event,
  dependencies: ProcessWebhookDependencies
): Promise<{
  readonly statusCode: number;
  readonly payload: Record<string, unknown>;
}> => {
  if (!allowedEvents.has(event.type)) {
    return {
      statusCode: 200,
      payload: { received: true, ignored: true, type: event.type }
    };
  }

  const payload =
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.expired' ||
    event.type === 'checkout.session.async_payment_succeeded' ||
    event.type === 'checkout.session.async_payment_failed'
      ? await handleStripeCheckoutEvent(event, {
          pool: dependencies.pool,
          publicBaseUrl: dependencies.publicBaseUrl
        })
      : await handleStripeFinancialEvent(event, {
          stripe: dependencies.stripe,
          pool: dependencies.pool,
          projectId: dependencies.projectId,
          publicBaseUrl: dependencies.publicBaseUrl
        });
  return { statusCode: 200, payload };
};

export const processStripeWebhook = async (
  rawBody: string,
  signature: string,
  dependencies: ProcessWebhookDependencies
): Promise<{
  readonly statusCode: number;
  readonly payload: Record<string, unknown>;
}> => {
  const { stripe, webhookSecret, pool } = dependencies;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return {
      statusCode: 400,
      payload: { error: 'Invalid Stripe webhook signature' }
    };
  }

  try {
    if (
      allowedEvents.has(event.type) &&
      !(await stripeEventBelongsToProject(
        event,
        stripe,
        pool,
        dependencies.projectId
      ))
    ) {
      return {
        statusCode: 200,
        payload: { received: true, ignored: true, reason: 'PROJECT_MISMATCH' }
      };
    }
    const result = await withStripeEventProcessing(
      pool,
      { stripeEventId: event.id, eventType: event.type, payload: event },
      (eventPool) =>
        processVerifiedStripeEvent(event, { ...dependencies, pool: eventPool })
    );
    if (result.status === 'processed') return result.value;
    if (result.status === 'busy') {
      return {
        statusCode: 503,
        payload: {
          received: false,
          error: 'Webhook event is already processing. Retry this delivery.'
        }
      };
    }
    return {
      statusCode: 200,
      payload: { received: true, duplicate: true, type: event.type }
    };
  } catch (error) {
    console.error('Failed to process Stripe webhook event.', {
      eventId: event.id,
      eventType: event.type,
      code:
        error instanceof Error &&
        [
          'REFUND_FINANCIAL_CORRECTION_REQUIRED',
          'REFUND_INVOICE_REQUIRED'
        ].includes(error.message)
          ? error.message
          : 'STRIPE_EVENT_PROCESSING_FAILED'
    });
    return {
      statusCode: 500,
      payload: {
        received: false,
        error: 'Webhook event could not be processed.'
      }
    };
  }
};
