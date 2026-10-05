const objectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const scalarFields = [
  'id',
  'object',
  'type',
  'created',
  'livemode',
  'currency',
  'status',
  'amount',
  'amount_total',
  'amount_received',
  'amount_refunded',
  'fee',
  'net',
  'payment_status',
  'refunded',
  'paid',
  'failure_code',
  'reason'
] as const;
const references = [
  'payment_intent',
  'charge',
  'balance_transaction',
  'latest_charge'
] as const;
const checkoutMetadataKeys = [
  'project',
  'projectId',
  'contributionType',
  'publicReference',
  'publicDisplayConsent',
  'displayAmountConsent',
  'nonCharityAcknowledged',
  'sponsorshipFollowupTokenHash',
  'openg7CheckoutOperationId',
  'checkoutOperationId'
] as const;

export const projectStoredCheckoutMetadata = (
  value: unknown
): Record<string, string> => {
  const source = objectRecord(value);
  const projected: Record<string, string> = {};
  for (const key of checkoutMetadataKeys) {
    if (typeof source[key] === 'string') projected[key] = source[key];
  }
  return projected;
};

/** Keep only correlation and financial facts needed by SQL projections, never customer/card data. */
const projectObject = (value: unknown): Record<string, unknown> => {
  const source = objectRecord(value);
  const result: Record<string, unknown> = {};
  for (const field of scalarFields) {
    const item = source[field];
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item))
      result[field] = item;
  }
  for (const field of references) {
    const item = source[field];
    if (typeof item === 'string' || item === null) result[field] = item;
    else if (item && typeof item === 'object')
      result[field] = projectObject(item);
  }
  if (source.refunds) {
    const refunds = objectRecord(source.refunds);
    result.refunds = {
      data: Array.isArray(refunds.data) ? refunds.data.map(projectObject) : [],
      has_more: refunds.has_more === true
    };
  }
  return result;
};

export const projectStoredStripeEvent = (
  value: unknown
): Record<string, unknown> => {
  const source = objectRecord(value);
  const projected = projectObject(source);
  const data = objectRecord(source.data);
  if (data.object) projected.data = { object: projectObject(data.object) };
  return projected;
};
