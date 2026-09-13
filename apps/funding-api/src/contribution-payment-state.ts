export type ContributionPaymentStatus =
  | 'pending'
  | 'expired'
  | 'failed'
  | 'paid'
  | 'disputed'
  | 'refunded';

// These are payment facts, independent of sponsor review/publication. A delayed
// failure or Checkout event must not erase an already confirmed payment, dispute
// or full refund. Resolving a dispute needs a separate authoritative workflow.
const paymentStatusPredecessors = {
  pending: ['pending'],
  expired: ['pending', 'expired'],
  failed: ['pending', 'expired', 'failed'],
  paid: ['pending', 'expired', 'failed', 'paid'],
  disputed: ['pending', 'expired', 'failed', 'paid', 'disputed'],
  refunded: ['pending', 'expired', 'failed', 'paid', 'disputed', 'refunded']
} as const satisfies Record<
  ContributionPaymentStatus,
  readonly ContributionPaymentStatus[]
>;

export const allowedPreviousPaymentStatuses = (
  incoming: ContributionPaymentStatus
): readonly ContributionPaymentStatus[] => paymentStatusPredecessors[incoming];
