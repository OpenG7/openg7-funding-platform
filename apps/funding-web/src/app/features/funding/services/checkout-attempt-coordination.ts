export const CHECKOUT_ATTEMPT_LOCK_NAME = 'openg7.checkout-attempts.v2';

export interface CheckoutAttemptCoordinator {
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
export function createCheckoutAttemptCoordinator(): CheckoutAttemptCoordinator {
  if (typeof window === 'undefined') return realmCoordinator;
  return {
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
}
