export const toIsoFromUnix = (seconds: number): string =>
  new Date(seconds * 1000).toISOString();

export const syntheticStripeEventId = (
  type: string,
  objectId: string
): string => `stripe-backfill:${type}:${objectId}`;

export const shouldStopAfterScan = (
  scanned: number,
  maxRecords: number | null
): boolean => maxRecords !== null && scanned >= maxRecords;
