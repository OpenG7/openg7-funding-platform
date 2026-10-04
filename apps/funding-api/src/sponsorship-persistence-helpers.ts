import type {
  AdminSponsorshipStripeRefundReason,
  AdminSponsorshipRefundWorkflowStatus,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';
export const allowedSponsorshipRefundWorkflowStatuses =
  new Set<AdminSponsorshipRefundWorkflowStatus>([
    'not_requested',
    'requested',
    'processing',
    'completed',
    'failed'
  ]);
export const allowedSponsorshipStripeRefundReasons =
  new Set<AdminSponsorshipStripeRefundReason>([
    'requested_by_customer',
    'duplicate',
    'fraudulent'
  ]);
export const allowedSponsorFeedTargets = new Set<SponsorFeedTarget>([
  'openg7',
  'openg20'
]);
export const allowedSponsorFeedChannels = new Set<SponsorFeedChannel>([
  'facebook',
  'linkedin'
]);

export const parseSponsorFeedChannels = (
  value: unknown
): readonly SponsorFeedChannel[] => {
  let raw = value;

  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((channel): channel is SponsorFeedChannel =>
    allowedSponsorFeedChannels.has(channel as SponsorFeedChannel)
  );
};

export const normalizeSponsorFeedTarget = (
  value: SponsorFeedTarget | null
): SponsorFeedTarget | null =>
  value && allowedSponsorFeedTargets.has(value) ? value : null;

export const normalizeSponsorshipRefundWorkflowStatus = (
  value: AdminSponsorshipRefundWorkflowStatus | null,
  paymentStatus?: string
): AdminSponsorshipRefundWorkflowStatus => {
  if (value && allowedSponsorshipRefundWorkflowStatuses.has(value)) {
    return value;
  }

  return paymentStatus === 'refunded' ? 'completed' : 'not_requested';
};

export const normalizeSponsorshipStripeRefundReason = (
  value: AdminSponsorshipStripeRefundReason | null
): AdminSponsorshipStripeRefundReason | null =>
  value && allowedSponsorshipStripeRefundReasons.has(value) ? value : null;
