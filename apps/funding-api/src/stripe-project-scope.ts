import type { Pool } from 'pg';
import type Stripe from 'stripe';

/** Missing metadata is not project evidence; conflicting tags always reject. */
export function stripeMetadataProject(
  metadata: Stripe.Metadata | null | undefined,
  projectId: string
): boolean | null {
  const tags = [metadata?.project, metadata?.projectId].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  return tags.length ? tags.every((value) => value === projectId) : null;
}

/** One matching object is enough only when neither object conflicts. */
export function stripeSessionBelongsToProject(
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent | null,
  projectId: string
): boolean {
  const sessionProject = stripeMetadataProject(session.metadata, projectId);
  const intentProject = stripeMetadataProject(
    paymentIntent?.metadata,
    projectId
  );
  return (
    sessionProject !== false &&
    intentProject !== false &&
    (sessionProject === true || intentProject === true)
  );
}

export async function stripeEventBelongsToProject(
  event: Stripe.Event,
  stripe: Stripe,
  pool: Pool | null,
  projectId: string
): Promise<boolean> {
  if (!projectId) throw new Error('Stripe project is required.');
  const value = event.data.object as {
    id: string;
    metadata?: Stripe.Metadata | null;
    payment_intent?: string | Stripe.PaymentIntent | null;
  };
  const tagged = stripeMetadataProject(value.metadata, projectId);
  if (tagged === false) return false;
  // Payouts aggregate an entire Stripe account: never infer their project.
  if (event.type.startsWith('payout.')) return tagged === true;
  const sessionId = event.type.startsWith('checkout.session.')
    ? value.id
    : null;
  const intent = event.type.startsWith('payment_intent.')
    ? (event.data.object as Stripe.PaymentIntent)
    : value.payment_intent;
  const intentId = typeof intent === 'string' ? intent : intent?.id;
  const intentProject =
    typeof intent === 'object' && intent
      ? stripeMetadataProject(intent.metadata, projectId)
      : null;
  if (intentProject === false) return false;
  if (tagged === true || intentProject === true) return true;
  if (pool && (sessionId || intentId)) {
    const known = await pool.query<{ metadata: Stripe.Metadata | null }>(
      `SELECT s.metadata FROM fund_contributions c
       LEFT JOIN stripe_checkout_sessions s ON s.stripe_session_id=c.stripe_session_id
       WHERE ($1::text IS NOT NULL AND c.stripe_session_id=$1)
          OR ($2::text IS NOT NULL AND c.stripe_payment_intent_id=$2)`,
      [sessionId, intentId ?? null]
    );
    if (known.rows.length)
      return known.rows.every(
        (row) => stripeMetadataProject(row.metadata, projectId) !== false
      );
  }
  // Charge/dispute events can precede Checkout and carry no project tag.
  if (typeof intent === 'string') {
    const authoritative = await stripe.paymentIntents.retrieve(intent);
    return stripeMetadataProject(authoritative.metadata, projectId) === true;
  }
  return false;
}
