import { createHash, randomBytes } from 'node:crypto';

import { isValidEmailAddress } from '../services/email/index.js';

const CONTRIBUTION_REFERENCE_BYTES = 6;
const CONTRIBUTION_REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const createContributionPublicReference = (): string => {
  const bytes = randomBytes(CONTRIBUTION_REFERENCE_BYTES);
  const suffix = Array.from(bytes, (byte) =>
    CONTRIBUTION_REFERENCE_ALPHABET.charAt(
      byte % CONTRIBUTION_REFERENCE_ALPHABET.length
    )
  ).join('');

  return `OG7-${new Date().getUTCFullYear()}-${suffix}`;
};

export const normalizeReferenceRecoveryEmail = (
  value: unknown
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const email = value.trim().toLowerCase();
  return isValidEmailAddress(email) ? email : null;
};

export const createReferenceRecoveryIdempotencyKey = (
  email: string
): string => {
  const emailHash = createHash('sha256').update(email).digest('hex');
  const hourBucket = new Date().toISOString().slice(0, 13);

  return `reference-recovery:${emailHash}:${hourBucket}`;
};

export const buildContributionReceiptDescription = (
  publicReference: string
): string => `Reference OpenG7: ${publicReference}`;

export const createContributionReferenceHelpers = ({
  publicBaseOrigin
}: {
  readonly publicBaseOrigin: string;
}) => {
  const buildContributionCheckoutSuccessUrl = (
    returnUrl: string,
    publicReference: string
  ): string => {
    const url = new URL(returnUrl, publicBaseOrigin);
    url.searchParams.set('reference', publicReference);
    return url.toString();
  };

  return { buildContributionCheckoutSuccessUrl };
};
