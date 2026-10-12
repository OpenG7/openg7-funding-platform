import type {
  CheckoutRequest,
  CheckoutResult,
  SponsorshipOfferQuote
} from '@openg7/funding-core';

import { parseContributionMinor } from '../models/funding-home.utils.js';

import {
  CheckoutAttemptCache,
  type StoredCheckoutAttempts
} from './checkout-attempt-cache.js';
import {
  createCheckoutAttemptCoordinator,
  type CheckoutAttemptCoordinator
} from './checkout-attempt-coordination.js';
import {
  CheckoutReconciliationRequiredError,
  CheckoutRecoveryUnavailableError,
  CheckoutOfferChangedError,
  CheckoutCharterChangedError
} from './checkout-error.js';
import {
  checkoutIntentFingerprint,
  checkoutIntentPayload,
  type CheckoutIntent
} from './checkout-intent.js';
import {
  CheckoutOfferRecovery,
  type CheckoutOfferResume
} from './checkout-offer-recovery.js';
import {
  CHECKOUT_RECOVERY_RETENTION_MS,
  type CheckoutAttemptStorage
} from './checkout-recovery-storage.js';

interface AttemptReservation {
  readonly idempotencyKey: string;
  readonly isNewAttempt: boolean;
}

/** Retain uncertain attempts without persisting contributor names or return URLs. */
export class CheckoutAttempts {
  private readonly pending = new Map<string, Promise<CheckoutResult>>();
  private readonly keys = new Map<string, string>();
  private readonly expiresAt = new Map<string, number>();
  private readonly cache: CheckoutAttemptCache;
  private readonly offers: CheckoutOfferRecovery;
  private pruning: Promise<void> | null = null;

  constructor(
    getStorage: () => CheckoutAttemptStorage | null = () => null,
    getLegacyStorage?: () => CheckoutAttemptStorage | null,
    private readonly coordinator: CheckoutAttemptCoordinator = createCheckoutAttemptCoordinator()
  ) {
    this.cache = new CheckoutAttemptCache(getStorage, getLegacyStorage);
    this.offers = new CheckoutOfferRecovery(getStorage);
  }

  async retainedSponsorshipOffer(
    amountMinor: number,
    currency: string
  ): Promise<CheckoutOfferResume> {
    return this.coordinator.run(async (writable) => {
      this.pruneExpired(writable);
      const remembered = this.readStoredAttempts();
      if (this.cache.requiresVerification())
        return { state: 'verification_required' };
      const resume = await this.offers.resume(amountMinor, currency, {
        ...remembered,
        ...Object.fromEntries(this.keys)
      });
      this.pruneExpired(writable);
      if (resume.state === 'verification_required')
        this.cache.requireVerification();
      if (this.cache.requiresVerification())
        return { state: 'verification_required' };
      if (!writable && resume.state === 'none') return { state: 'unavailable' };
      return resume;
    });
  }

  requiresVerification(): boolean {
    const expiredOffers = this.offers.expiredOwners();
    if (Object.keys(expiredOffers).length) this.cache.requireVerification();
    const required = this.cache.requiresVerification();
    if (
      !this.pruning &&
      (Object.keys(expiredOffers).length ||
        Object.values(this.cache.read()).some(
          (entry) => entry.expiresAt <= Date.now()
        ))
    ) {
      this.pruning = this.coordinator
        .run((writable) => this.pruneExpired(writable))
        .catch(() => undefined)
        .finally(() => {
          this.pruning = null;
        });
    }
    return required || this.cache.requiresVerification();
  }

  start(
    intent: CheckoutIntent,
    execute: (request: CheckoutRequest) => Promise<CheckoutResult>,
    offerQuote?: SponsorshipOfferQuote
  ): Promise<CheckoutResult> {
    if (this.requiresVerification())
      return Promise.reject(new CheckoutReconciliationRequiredError());
    const payload = checkoutIntentPayload(intent);
    const existing = this.pending.get(payload);
    if (existing) return existing;
    const pending = this.execute(intent, payload, execute, offerQuote).finally(
      () => this.pending.delete(payload)
    );
    this.pending.set(payload, pending);
    return pending;
  }

  private async execute(
    intent: CheckoutIntent,
    payload: string,
    execute: (request: CheckoutRequest) => Promise<CheckoutResult>,
    offerQuote?: SponsorshipOfferQuote
  ): Promise<CheckoutResult> {
    if (intent.contributionType === 'sponsorship_interest' && !offerQuote)
      throw new CheckoutOfferChangedError(
        'SPONSORSHIP_OFFER_ACCEPTANCE_REQUIRED'
      );
    if (
      offerQuote &&
      intent.contributionType === 'sponsorship_interest' &&
      (offerQuote.amountMinor !==
        parseContributionMinor(String(intent.amount)) ||
        offerQuote.currency !== intent.currency ||
        offerQuote.version !== intent.offerAcceptance?.version ||
        offerQuote.fingerprint !== intent.offerAcceptance?.fingerprint)
    ) {
      this.cache.requireVerification();
      throw new CheckoutReconciliationRequiredError();
    }
    const fingerprint = await checkoutIntentFingerprint(payload);
    const reservation = await this.coordinator.run((writable) =>
      this.reserve(intent, fingerprint, offerQuote, writable)
    );
    let result: CheckoutResult;
    // The API owns server idempotence. No network wait holds a browser lock.
    try {
      result = await execute({
        ...intent,
        idempotencyKey: reservation.idempotencyKey
      });
    } catch (error) {
      if (error instanceof CheckoutReconciliationRequiredError)
        this.cache.requireVerification();
      else if (
        error instanceof CheckoutOfferChangedError ||
        error instanceof CheckoutCharterChangedError
      ) {
        if (error.code.endsWith('INVALID') && !reservation.isNewAttempt) {
          this.cache.requireVerification();
          throw new CheckoutReconciliationRequiredError();
        }
        // A refusal does not settle another request sharing this UUID. Retain the
        // original terms; a changed intent requires verification before any API call.
      }
      throw error;
    }
    await this.complete(fingerprint, reservation.idempotencyKey);
    return result;
  }

  private async reserve(
    intent: CheckoutIntent,
    fingerprint: string,
    offerQuote: SponsorshipOfferQuote | undefined,
    writable: boolean
  ): Promise<AttemptReservation> {
    this.pruneExpired(writable);
    const remembered = this.readStoredAttempts();
    if (
      this.cache.requiresVerification() ||
      (this.expiresAt.get(fingerprint) ?? Infinity) <= Date.now()
    ) {
      this.cache.requireVerification();
      throw new CheckoutReconciliationRequiredError();
    }
    const accepted = await this.offers.acceptsIntent(
      fingerprint,
      intent.offerAcceptance,
      {
        ...remembered,
        ...Object.fromEntries(this.keys)
      }
    );
    this.pruneExpired(writable);
    // Re-read after checksum awaits: no stale snapshot can mint an operation key.
    const latest = this.readStoredAttempts();
    if (
      !accepted ||
      this.cache.requiresVerification() ||
      JSON.stringify(remembered) !== JSON.stringify(latest)
    ) {
      this.cache.requireVerification();
      throw new CheckoutReconciliationRequiredError();
    }
    const knownKey = latest[fingerprint] ?? this.keys.get(fingerprint);
    if (
      !writable &&
      !knownKey &&
      (intent.contributionType === 'sponsorship_interest' ||
        this.cache.hasReadableStorage())
    )
      throw new CheckoutRecoveryUnavailableError();
    const idempotencyKey = knownKey ?? globalThis.crypto.randomUUID();
    const isNewAttempt = !knownKey;
    this.keys.set(fingerprint, idempotencyKey);
    if (!this.expiresAt.has(fingerprint))
      this.expiresAt.set(
        fingerprint,
        Date.now() + CHECKOUT_RECOVERY_RETENTION_MS
      );
    if (!writable) return { idempotencyKey, isNewAttempt };
    const attemptSaved = this.writeStoredAttempts({
      ...latest,
      [fingerprint]: idempotencyKey
    });
    if (offerQuote && intent.contributionType === 'sponsorship_interest') {
      const offerSaved = this.offers.capture(
        fingerprint,
        idempotencyKey,
        offerQuote
      );
      if (isNewAttempt && (!attemptSaved || !offerSaved)) {
        this.completeOwned(fingerprint, idempotencyKey, true);
        throw new CheckoutRecoveryUnavailableError();
      }
    }
    return { idempotencyKey, isNewAttempt };
  }

  private complete(fingerprint: string, idempotencyKey: string): Promise<void> {
    return this.coordinator.run((writable) =>
      this.completeOwned(fingerprint, idempotencyKey, writable)
    );
  }

  private completeOwned(
    fingerprint: string,
    idempotencyKey: string,
    writable: boolean
  ): void {
    if (this.keys.get(fingerprint) === idempotencyKey) {
      this.keys.delete(fingerprint);
      this.expiresAt.delete(fingerprint);
    }
    if (!writable) {
      this.offers.forget(fingerprint, idempotencyKey, false);
      return;
    }
    const completed = this.cache.read();
    const owner = completed[fingerprint]?.idempotencyKey;
    if (
      (owner && owner !== idempotencyKey) ||
      !this.offers.ownerMatches(fingerprint, idempotencyKey)
    )
      return;
    if (owner === idempotencyKey) {
      delete completed[fingerprint];
      this.cache.write(completed);
    }
    this.offers.forget(fingerprint, idempotencyKey);
  }

  private pruneExpired(writable: boolean): void {
    if (!writable) return;
    this.cache.pruneExpired((fingerprint, key) => {
      if (this.keys.get(fingerprint) === key) {
        this.keys.delete(fingerprint);
        this.expiresAt.delete(fingerprint);
      }
      this.offers.forget(fingerprint, key);
    }, this.offers.expiredOwners());
  }

  private readStoredAttempts(): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const [fingerprint, entry] of Object.entries(this.cache.read())) {
      if (entry.expiresAt > Date.now()) {
        entries[fingerprint] = entry.idempotencyKey;
        this.expiresAt.set(fingerprint, entry.expiresAt);
      }
    }
    return entries;
  }

  private writeStoredAttempts(attempts: Record<string, string>): boolean {
    const entries: StoredCheckoutAttempts = {};
    for (const [fingerprint, idempotencyKey] of Object.entries(attempts)) {
      const expiresAt = this.expiresAt.get(fingerprint);
      if (expiresAt === undefined) return false;
      entries[fingerprint] = { idempotencyKey, expiresAt };
    }
    return this.cache.write(entries);
  }
}
