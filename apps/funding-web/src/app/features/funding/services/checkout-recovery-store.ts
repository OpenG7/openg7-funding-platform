import {
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  CHECKOUT_OFFER_STORAGE_KEY,
  CHECKOUT_VERIFICATION_STORAGE_KEY,
  type CheckoutAttemptStorage
} from './checkout-recovery-storage.js';

export const CHECKOUT_RECOVERY_DATABASE = 'openg7.checkout-recovery.v1';
const objectStore = 'recovery';
const recordKey = 'snapshot';
const recoveryKeys = [
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  CHECKOUT_OFFER_STORAGE_KEY,
  CHECKOUT_VERIFICATION_STORAGE_KEY
] as const;
export type CheckoutRecoverySnapshot = Partial<Record<string, string>>;

/** A single committed record also marks completion of the legacy-cache import. */
export interface CheckoutRecoveryStore {
  read(): Promise<CheckoutRecoverySnapshot | null>;
  write(snapshot: CheckoutRecoverySnapshot): Promise<void>;
}

export function readCheckoutRecoveryMirror(
  storage: CheckoutAttemptStorage | null
): CheckoutRecoverySnapshot {
  if (!storage) throw new Error('Checkout recovery storage is unavailable.');
  const snapshot: CheckoutRecoverySnapshot = {};
  for (const key of recoveryKeys) {
    const value = storage.getItem(key);
    if (value !== null) snapshot[key] = value;
  }
  const legacy = storage.getItem('openg7.checkout-attempts.v1');
  if (legacy && legacy !== '{}')
    snapshot[CHECKOUT_VERIFICATION_STORAGE_KEY] = 'true';
  return snapshot;
}

export function mirrorCheckoutRecovery(
  storage: CheckoutAttemptStorage | null,
  snapshot: CheckoutRecoverySnapshot
): void {
  if (!storage) return;
  for (const key of recoveryKeys) {
    const value = snapshot[key];
    if (value === undefined) storage.removeItem(key);
    else storage.setItem(key, value);
  }
}

function normalizeSnapshot(value: unknown): CheckoutRecoverySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Checkout recovery snapshot.');
  const snapshot: CheckoutRecoverySnapshot = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      !recoveryKeys.some((allowed) => allowed === key) ||
      typeof item !== 'string'
    )
      throw new Error('Invalid Checkout recovery snapshot entry.');
    snapshot[key] = item;
  }
  return snapshot;
}

/** Transactions contain only IDB requests; asynchronous checksums run between them. */
export function createIndexedCheckoutRecoveryStore(
  factory: IDBFactory
): CheckoutRecoveryStore {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = factory.open(CHECKOUT_RECOVERY_DATABASE, 1);
      let failed = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore(objectStore);
      };
      request.onerror = () => {
        failed = true;
        reject(request.error);
      };
      request.onblocked = () => {
        failed = true;
        reject(new Error('Checkout recovery upgrade is blocked.'));
      };
      request.onsuccess = () => {
        if (failed) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  return {
    async read() {
      const database = await open();
      try {
        return await new Promise<CheckoutRecoverySnapshot | null>(
          (resolve, reject) => {
            const transaction = database.transaction(objectStore, 'readonly');
            const request = transaction.objectStore(objectStore).get(recordKey);
            transaction.onabort = () => reject(transaction.error);
            transaction.onerror = () => reject(transaction.error);
            transaction.oncomplete = () => {
              try {
                resolve(
                  request.result === undefined
                    ? null
                    : normalizeSnapshot(request.result)
                );
              } catch (error) {
                reject(error);
              }
            };
          }
        );
      } finally {
        database.close();
      }
    },
    async write(snapshot) {
      const database = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(objectStore, 'readwrite');
          transaction.onabort = () => reject(transaction.error);
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => resolve();
          transaction
            .objectStore(objectStore)
            .put(normalizeSnapshot(snapshot), recordKey);
        });
      } finally {
        database.close();
      }
    }
  };
}
