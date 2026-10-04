import type { CheckoutRequest, CheckoutResult } from '@openg7/funding-core';

import { CheckoutReconciliationRequiredError } from './checkout-error.js';

type CheckoutIntent = Omit<CheckoutRequest, 'idempotencyKey'>;
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const storageKey = 'openg7.checkout-attempts.v1';
const verificationStorageKey = 'openg7.checkout-verification-required.v1';
const fingerprintPattern = /^[a-f0-9]{64}$/;
const attemptKeyPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** Retain uncertain attempts without persisting contributor names or return URLs. */
export class CheckoutAttempts {
  private readonly pending = new Map<string, Promise<CheckoutResult>>();
  private readonly keys = new Map<string, string>();
  private verificationRequired = false;

  constructor(
    private readonly getStorage: () => AttemptStorage | null = () => null
  ) {}

  requiresVerification(): boolean {
    if (this.verificationRequired) return true;
    try {
      return this.getStorage()?.getItem(verificationStorageKey) === 'true';
    } catch {
      return false;
    }
  }

  start(
    intent: CheckoutIntent,
    execute: (request: CheckoutRequest) => Promise<CheckoutResult>
  ): Promise<CheckoutResult> {
    if (this.requiresVerification())
      return Promise.reject(new CheckoutReconciliationRequiredError());
    const payload = JSON.stringify([
      intent.amount,
      intent.currency,
      intent.projectId,
      intent.successUrl,
      intent.cancelUrl,
      intent.contributionType,
      intent.publicDisplayConsent,
      intent.publicDisplayName,
      intent.displayAmountConsent,
      intent.nonCharityAcknowledged
    ]);
    const existing = this.pending.get(payload);
    if (existing) return existing;

    const pending = this.execute(intent, payload, execute).finally(() => {
      this.pending.delete(payload);
    });
    this.pending.set(payload, pending);
    return pending;
  }

  private async execute(
    intent: CheckoutIntent,
    payload: string,
    execute: (request: CheckoutRequest) => Promise<CheckoutResult>
  ): Promise<CheckoutResult> {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(payload)
    );
    const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const remembered = this.readStoredAttempts();
    const idempotencyKey =
      remembered[fingerprint] ??
      this.keys.get(fingerprint) ??
      globalThis.crypto.randomUUID();
    this.keys.set(fingerprint, idempotencyKey);
    this.writeStoredAttempts({ ...remembered, [fingerprint]: idempotencyKey });

    // A failed or undecodable response leaves the key available for a safe retry.
    let result: CheckoutResult;
    try {
      result = await execute({ ...intent, idempotencyKey });
    } catch (error) {
      if (error instanceof CheckoutReconciliationRequiredError) {
        this.verificationRequired = true;
        try {
          this.getStorage()?.setItem(verificationStorageKey, 'true');
        } catch {
          // Retain the block in memory when browser storage is restricted.
        }
      }
      throw error;
    }
    this.keys.delete(fingerprint);
    const completed = this.readStoredAttempts();
    if (completed[fingerprint] === idempotencyKey) {
      delete completed[fingerprint];
      this.writeStoredAttempts(completed);
    }
    return result;
  }

  private readStoredAttempts(): Record<string, string> {
    try {
      const serialized = this.getStorage()?.getItem(storageKey);
      if (!serialized) return {};
      const parsed: unknown = JSON.parse(serialized);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      )
        return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          ([fingerprint, key]) =>
            fingerprintPattern.test(fingerprint) &&
            typeof key === 'string' &&
            attemptKeyPattern.test(key)
        )
      );
    } catch {
      return {};
    }
  }

  private writeStoredAttempts(attempts: Record<string, string>): void {
    try {
      const storage = this.getStorage();
      if (Object.keys(attempts).length === 0) storage?.removeItem(storageKey);
      else storage?.setItem(storageKey, JSON.stringify(attempts));
    } catch {
      // Restricted storage still allows retries during this service's lifetime.
    }
  }
}
