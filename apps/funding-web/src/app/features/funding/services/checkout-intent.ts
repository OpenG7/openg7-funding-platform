import type { CheckoutRequest } from '@openg7/funding-core';

export type CheckoutIntent = Omit<CheckoutRequest, 'idempotencyKey'>;

/** This private payload exists only in memory; storage receives its digest. */
export function checkoutIntentPayload(intent: CheckoutIntent): string {
  return JSON.stringify([
    intent.amount,
    intent.currency,
    intent.projectId,
    intent.successUrl,
    intent.cancelUrl,
    intent.contributionType,
    intent.publicDisplayConsent,
    intent.publicDisplayName,
    intent.displayAmountConsent,
    intent.nonCharityAcknowledged,
    ...(intent.charterAcceptance
      ? [
          intent.charterAcceptance.policyVersion,
          intent.charterAcceptance.fingerprint,
          intent.charterAcceptance.locale,
          intent.charterAcceptance.accepted
        ]
      : []),
    ...(intent.offerAcceptance
      ? [intent.offerAcceptance.version, intent.offerAcceptance.fingerprint]
      : [])
  ]);
}

export async function checkoutIntentFingerprint(
  payload: string
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
