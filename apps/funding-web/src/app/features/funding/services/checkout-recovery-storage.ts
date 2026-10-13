export type CheckoutAttemptStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export const CHECKOUT_RECOVERY_RETENTION_MS = 24 * 60 * 60 * 1000;
export const CHECKOUT_ATTEMPT_STORAGE_KEY = 'openg7.checkout-attempts.v2';
export const CHECKOUT_OFFER_STORAGE_KEY = 'openg7.checkout-offer-recovery.v1';
export const CHECKOUT_VERIFICATION_STORAGE_KEY =
  'openg7.checkout-verification-required.v1';
export const checkoutFingerprintPattern = /^[a-f0-9]{64}$/;
export const checkoutAttemptKeyPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
