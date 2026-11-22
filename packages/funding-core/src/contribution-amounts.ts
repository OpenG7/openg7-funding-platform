/** Personal contributions use CAD major units; preset amounts are suggestions. */
export const MINIMUM_PERSONAL_CONTRIBUTION_AMOUNT = 5;

export function isValidPersonalContributionAmount(
  amount: unknown
): amount is number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
  const minor = Math.round(amount * 100);
  return (
    Number.isSafeInteger(minor) &&
    amount === minor / 100 &&
    minor >= MINIMUM_PERSONAL_CONTRIBUTION_AMOUNT * 100
  );
}
