import {
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  CHECKOUT_RECOVERY_RETENTION_MS,
  CHECKOUT_VERIFICATION_STORAGE_KEY,
  checkoutAttemptKeyPattern,
  checkoutFingerprintPattern,
  type CheckoutAttemptStorage
} from './checkout-recovery-storage.js';

export interface StoredCheckoutAttempt {
  readonly idempotencyKey: string;
  readonly expiresAt: number;
}
export type StoredCheckoutAttempts = Record<string, StoredCheckoutAttempt>;

/** Reads never prune shared records. Call mutations only inside the coordinator. */
export class CheckoutAttemptCache {
  private verificationRequired = false;
  constructor(
    private readonly getStorage: () => CheckoutAttemptStorage | null,
    private readonly getLegacyStorage?: () => CheckoutAttemptStorage | null
  ) {}

  read(): StoredCheckoutAttempts {
    let serialized: string | null | undefined;
    try {
      serialized = this.getStorage()?.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      if (!serialized) return {};
      const parsed: unknown = JSON.parse(serialized);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Invalid Checkout recovery cache.');
      const entries: StoredCheckoutAttempts = {};
      for (const [fingerprint, value] of Object.entries(parsed)) {
        const entry = value as Partial<StoredCheckoutAttempt> | null;
        if (
          !checkoutFingerprintPattern.test(fingerprint) ||
          !entry ||
          typeof entry.idempotencyKey !== 'string' ||
          !checkoutAttemptKeyPattern.test(entry.idempotencyKey) ||
          !Number.isSafeInteger(entry.expiresAt) ||
          entry.expiresAt! > Date.now() + CHECKOUT_RECOVERY_RETENTION_MS
        )
          throw new Error('Invalid Checkout recovery entry.');
        entries[fingerprint] = {
          idempotencyKey: entry.idempotencyKey,
          expiresAt: entry.expiresAt!
        };
        if (entry.expiresAt! <= Date.now()) this.requireVerification();
      }
      return entries;
    } catch {
      if (serialized) this.requireVerification();
      return {};
    }
  }

  requiresVerification(): boolean {
    this.read();
    if (this.verificationRequired) return true;
    try {
      const legacy = this.getLegacyStorage?.();
      if (
        legacy?.getItem(CHECKOUT_VERIFICATION_STORAGE_KEY) === 'true' ||
        [
          legacy?.getItem('openg7.checkout-attempts.v1'),
          legacy?.getItem('openg7.checkout-offer-recovery.v1')
        ].some((value) => value && value !== '{}')
      ) {
        this.requireVerification();
        return true;
      }
    } catch {
      // Denied legacy storage cannot hide a durable verification flag.
    }
    try {
      const storage = this.getStorage();
      const legacy = storage?.getItem('openg7.checkout-attempts.v1');
      if (
        storage?.getItem(CHECKOUT_VERIFICATION_STORAGE_KEY) === 'true' ||
        (legacy && legacy !== '{}')
      ) {
        this.requireVerification();
        return true;
      }
    } catch {
      // The known block remains in memory.
    }
    return this.verificationRequired;
  }

  requireVerification(): void {
    this.verificationRequired = true;
    try {
      this.getStorage()?.setItem(CHECKOUT_VERIFICATION_STORAGE_KEY, 'true');
    } catch {
      // A monotone block survives denied storage in memory.
    }
  }

  hasReadableStorage(): boolean {
    try {
      const storage = this.getStorage();
      if (!storage) return false;
      storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  write(entries: StoredCheckoutAttempts): boolean {
    try {
      const storage = this.getStorage();
      if (!storage) return false;
      if (!Object.keys(entries).length) {
        storage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
        return storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) === null;
      }
      const serialized = JSON.stringify(entries);
      if (storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) === serialized)
        return true;
      storage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, serialized);
      return storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) === serialized;
    } catch {
      return false;
    }
  }

  /** The verification marker precedes removal; expired records never become new attempts. */
  pruneExpired(
    removeOffer: (fingerprint: string, key: string) => void,
    expiredOfferOwners: Readonly<Record<string, string>> = {}
  ): void {
    const entries = this.read();
    const expired = Object.entries(entries).filter(
      ([, entry]) => entry.expiresAt <= Date.now()
    );
    if (!expired.length && !Object.keys(expiredOfferOwners).length) return;
    this.requireVerification();
    try {
      if (
        this.getStorage()?.getItem(CHECKOUT_VERIFICATION_STORAGE_KEY) !== 'true'
      )
        return;
      for (const [fingerprint] of expired) delete entries[fingerprint];
      if (this.write(entries)) {
        for (const [fingerprint, entry] of expired)
          removeOffer(fingerprint, entry.idempotencyKey);
        for (const [fingerprint, key] of Object.entries(expiredOfferOwners))
          removeOffer(fingerprint, key);
      }
    } catch {
      // A refused purge keeps the block and is retried when coordination is available.
    }
  }
}
