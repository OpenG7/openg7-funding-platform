/** Public allocation policy shared by the API and its confirmation UI. */
export const PUBLIC_ALLOCATION_CREATE_CONFIRMATION = 'CREATE_PUBLIC_ALLOCATION';

export const isPublicAllocationStatus = (status: string | undefined): boolean =>
  status === 'published' || status === 'active';

export const allocationRequiresConfirmation = (
  current: string | undefined,
  next: string | undefined
): boolean =>
  isPublicAllocationStatus(current) ||
  isPublicAllocationStatus(next) ||
  (next !== undefined &&
    next !== current &&
    ['private', 'archived'].includes(next));

/** Preserve the decimal API contract while rejecting rounding and unsafe integers. */
export function allocationAmountMinor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const minor = Math.round(value * 100);
  return minor > 0 && Number.isSafeInteger(minor) && minor / 100 === value
    ? minor
    : null;
}

export function isPublicAllocationProofUrl(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
