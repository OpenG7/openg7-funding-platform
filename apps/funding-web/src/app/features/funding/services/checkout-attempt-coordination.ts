import { CheckoutRecoveryUnavailableError } from './checkout-error.js';
import {
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  CHECKOUT_VERIFICATION_STORAGE_KEY,
  type CheckoutAttemptStorage
} from './checkout-recovery-storage.js';
import {
  createIndexedCheckoutRecoveryStore,
  mirrorCheckoutRecovery,
  readCheckoutRecoveryMirror,
  type CheckoutRecoverySnapshot,
  type CheckoutRecoveryStore
} from './checkout-recovery-store.js';

export const CHECKOUT_ATTEMPT_LOCK_NAME = 'openg7.checkout-attempts.v2';

export interface CheckoutAttemptCoordinator {
  getStorage?(): CheckoutAttemptStorage;
  hasDurableAttempt?(fingerprint: string, key: string): boolean;
  run<T>(
    operation: (sharedCacheWritable: boolean) => T | Promise<T>
  ): Promise<T>;
}

/** One realm's synthetic/SSR storage; real browser storage requires Web Locks. */
const realmCoordinator: CheckoutAttemptCoordinator = (() => {
  let pending = Promise.resolve();
  return {
    run<T>(operation: (sharedCacheWritable: boolean) => T | Promise<T>) {
      const result = pending.then(() => operation(true));
      pending = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    }
  };
})();

/** Only reservations and cleanup belong here; never await the Checkout API in a lock. */
export function createCheckoutAttemptCoordinator(
  getStorage?: () => CheckoutAttemptStorage | null
): CheckoutAttemptCoordinator {
  if (typeof window === 'undefined') return realmCoordinator;
  const locksCoordinator: CheckoutAttemptCoordinator = {
    async run<T>(operation: (sharedCacheWritable: boolean) => T | Promise<T>) {
      let locks: LockManager | undefined;
      try {
        if (window.isSecureContext) locks = window.navigator.locks;
      } catch {
        // Missing or denied locks cannot authorize a shared-cache mutation.
      }
      if (!locks) return operation(false);
      let entered = false;
      try {
        return await locks.request(
          CHECKOUT_ATTEMPT_LOCK_NAME,
          { mode: 'exclusive' },
          () => {
            entered = true;
            return operation(true);
          }
        );
      } catch (error) {
        if (entered) throw error;
        return operation(false);
      }
    }
  };
  if (!getStorage) return locksCoordinator;
  const store: CheckoutRecoveryStore = {
    read: () => createIndexedCheckoutRecoveryStore(window.indexedDB).read(),
    write: (snapshot) =>
      createIndexedCheckoutRecoveryStore(window.indexedDB).write(snapshot)
  };
  return coordinateCheckoutRecovery(getStorage, store, locksCoordinator);
}

/** Web Locks serialize operations; committed IDB snapshots provide visibility across processes. */
export function coordinateCheckoutRecovery(
  getMirror: () => CheckoutAttemptStorage | null,
  store: CheckoutRecoveryStore,
  locks: CheckoutAttemptCoordinator
): CheckoutAttemptCoordinator {
  let snapshot: CheckoutRecoverySnapshot = {};
  let verificationRequired = false;
  let active = false;
  let markerFlush: Promise<unknown> | null = null;
  const durableAttempts = new Set<string>();
  const rememberDurableAttempts = () => {
    try {
      const entries = JSON.parse(
        snapshot[CHECKOUT_ATTEMPT_STORAGE_KEY] ?? '{}'
      );
      for (const [fingerprint, entry] of Object.entries(entries)) {
        const key = (entry as { idempotencyKey?: unknown } | null)
          ?.idempotencyKey;
        if (typeof key === 'string')
          durableAttempts.add(`${fingerprint}:${key}`);
      }
    } catch {
      // The cache validates malformed entries and raises its monotone block.
    }
  };
  const storage: CheckoutAttemptStorage = {
    getItem: (key) => {
      if (key === CHECKOUT_VERIFICATION_STORAGE_KEY) {
        try {
          verificationRequired ||= getMirror()?.getItem(key) === 'true';
        } catch {
          // Only a positive mirror marker can affect the canonical block.
        }
        if (verificationRequired) return 'true';
      }
      return snapshot[key] ?? null;
    },
    setItem: (key, value) => {
      snapshot[key] = value;
      if (key !== CHECKOUT_VERIFICATION_STORAGE_KEY || value !== 'true') return;
      verificationRequired = true;
      try {
        getMirror()?.setItem(key, value);
      } catch {
        // The canonical marker is committed under the next lock.
      }
      if (!active && !markerFlush) {
        markerFlush = coordinator
          .run(() => undefined)
          .catch(() => undefined)
          .finally(() => {
            markerFlush = null;
          });
      }
    },
    removeItem: (key) => {
      if (key !== CHECKOUT_VERIFICATION_STORAGE_KEY) delete snapshot[key];
    }
  };
  const coordinator: CheckoutAttemptCoordinator = {
    getStorage: () => storage,
    hasDurableAttempt: (fingerprint, key) =>
      durableAttempts.has(`${fingerprint}:${key}`),
    run<T>(
      operation: (sharedCacheWritable: boolean) => T | Promise<T>
    ): Promise<T> {
      return locks.run(async (writable) => {
        let stored: CheckoutRecoverySnapshot | null;
        try {
          stored = await store.read();
          snapshot = structuredClone(
            stored ?? readCheckoutRecoveryMirror(getMirror())
          );
          rememberDurableAttempts();
        } catch {
          // A known, previously committed UUID may retry read-only. A readable empty
          // snapshot cannot authorize a new key when the canonical store is denied.
          writable = false;
          stored = structuredClone(snapshot);
        }
        try {
          verificationRequired ||=
            getMirror()?.getItem(CHECKOUT_VERIFICATION_STORAGE_KEY) === 'true';
        } catch {
          // A mirror cannot revoke the canonical or in-memory block.
        }
        verificationRequired ||=
          snapshot[CHECKOUT_VERIFICATION_STORAGE_KEY] === 'true';
        if (verificationRequired)
          snapshot[CHECKOUT_VERIFICATION_STORAGE_KEY] = 'true';
        const before = JSON.stringify(stored);
        active = true;
        let result: T | undefined;
        let failed = false;
        let failure: unknown;
        try {
          result = await operation(writable);
        } catch (error) {
          failed = true;
          failure = error;
        } finally {
          active = false;
        }
        if (writable && before !== JSON.stringify(snapshot)) {
          try {
            await store.write(snapshot);
            rememberDurableAttempts();
          } catch {
            snapshot = stored ?? {};
            if (verificationRequired)
              snapshot[CHECKOUT_VERIFICATION_STORAGE_KEY] = 'true';
            throw new CheckoutRecoveryUnavailableError();
          }
        }
        if (writable) {
          try {
            mirrorCheckoutRecovery(getMirror(), snapshot);
          } catch {
            // Compatibility only: a failed or stale mirror does not replace IDB.
          }
        }
        if (failed) throw failure;
        return result as T;
      });
    }
  };
  return coordinator;
}
