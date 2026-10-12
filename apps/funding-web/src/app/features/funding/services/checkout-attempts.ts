import type {
  CheckoutRequest,
  CheckoutResult,
  SponsorshipOfferQuote
} from '@openg7/funding-core';

import { parseContributionMinor } from '../models/funding-home.utils.js';

import {
  CheckoutReconciliationRequiredError,
  CheckoutRecoveryUnavailableError,
  CheckoutOfferChangedError,
  CheckoutCharterChangedError
} from './checkout-error.js';
import {
  CHECKOUT_RECOVERY_RETENTION_MS,
  CheckoutOfferRecovery,
  type CheckoutAttemptStorage,
  type CheckoutOfferResume
} from './checkout-offer-recovery.js';

type CheckoutIntent = Omit<CheckoutRequest, 'idempotencyKey'>;

const storageKey = 'openg7.checkout-attempts.v2';
const legacyStorageKey = 'openg7.checkout-attempts.v1';
const verificationStorageKey = 'openg7.checkout-verification-required.v1';
const fingerprintPattern = /^[a-f0-9]{64}$/;
const attemptKeyPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** Retain uncertain attempts without persisting contributor names or return URLs. */
export class CheckoutAttempts {
  private readonly pending = new Map<string, Promise<CheckoutResult>>();
  private readonly keys = new Map<string, string>();
  private readonly expiresAt = new Map<string, number>();
  private verificationRequired = false;
  private readonly offers: CheckoutOfferRecovery;

  constructor(
    private readonly getStorage: () => CheckoutAttemptStorage | null = () =>
      null,
    private readonly getLegacyStorage?: () => CheckoutAttemptStorage | null
  ) {
    this.offers = new CheckoutOfferRecovery(getStorage);
  }

  async retainedSponsorshipOffer(
    amountMinor: number,
    currency: string
  ): Promise<CheckoutOfferResume> {
    if (this.requiresVerification()) return { state: 'verification_required' };
    const remembered = this.readStoredAttempts();
    if (this.requiresVerification()) return { state: 'verification_required' };
    const resume = await this.offers.resume(amountMinor, currency, {
      ...remembered,
      ...Object.fromEntries(this.keys)
    });
    if (resume.state === 'verification_required') this.requireVerification();
    return resume;
  }

  requiresVerification(): boolean {
    // A pre-existing block does not extend retention of expired recovery data.
    this.readStoredAttempts();
    if (this.verificationRequired) return true;
    try {
      const legacy = this.getLegacyStorage?.();
      if (
        legacy?.getItem(verificationStorageKey) === 'true' ||
        [
          legacy?.getItem(legacyStorageKey),
          legacy?.getItem('openg7.checkout-offer-recovery.v1')
        ].some((value) => value && value !== '{}')
      ) {
        this.requireVerification();
        return true;
      }
    } catch {
      // Restrictions on old session storage cannot hide a block in local storage.
    }
    try {
      const storage = this.getStorage();
      const legacy = storage?.getItem(legacyStorageKey);
      if (
        storage?.getItem(verificationStorageKey) === 'true' ||
        (legacy && legacy !== '{}')
      ) {
        this.requireVerification();
        return true;
      }
      return false;
    } catch {
      return this.verificationRequired;
    }
  }

  start(
    intent: CheckoutIntent,
    execute: (request: CheckoutRequest) => Promise<CheckoutResult>,
    offerQuote?: SponsorshipOfferQuote
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
    const existing = this.pending.get(payload);
    if (existing) return existing;

    const pending = this.execute(intent, payload, execute, offerQuote).finally(
      () => {
        this.pending.delete(payload);
      }
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
      this.requireVerification();
      throw new CheckoutReconciliationRequiredError();
    }
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(payload)
    );
    const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const remembered = this.readStoredAttempts();
    if (
      this.requiresVerification() ||
      (this.expiresAt.get(fingerprint) ?? Infinity) <= Date.now()
    ) {
      this.requireVerification();
      throw new CheckoutReconciliationRequiredError();
    }
    if (
      !(await this.offers.acceptsIntent(fingerprint, intent.offerAcceptance, {
        ...remembered,
        ...Object.fromEntries(this.keys)
      }))
    ) {
      this.requireVerification();
      throw new CheckoutReconciliationRequiredError();
    }
    const idempotencyKey =
      remembered[fingerprint] ??
      this.keys.get(fingerprint) ??
      globalThis.crypto.randomUUID();
    const isNewAttempt =
      !remembered[fingerprint] && !this.keys.has(fingerprint);
    this.keys.set(fingerprint, idempotencyKey);
    if (!this.expiresAt.has(fingerprint))
      this.expiresAt.set(
        fingerprint,
        Date.now() + CHECKOUT_RECOVERY_RETENTION_MS
      );
    const attemptSaved = this.writeStoredAttempts({
      ...remembered,
      [fingerprint]: idempotencyKey
    });
    if (offerQuote && intent.contributionType === 'sponsorship_interest') {
      const offerSaved = this.offers.capture(
        fingerprint,
        idempotencyKey,
        offerQuote
      );
      // An existing exact intent can retry its known key in memory. A new operation
      // must retain both its key and public terms before making any API request.
      if (isNewAttempt && (!attemptSaved || !offerSaved)) {
        this.complete(fingerprint, idempotencyKey);
        throw new CheckoutRecoveryUnavailableError();
      }
    }

    // A failed or undecodable response leaves the key available for a safe retry.
    let result: CheckoutResult;
    try {
      result = await execute({ ...intent, idempotencyKey });
    } catch (error) {
      if (error instanceof CheckoutReconciliationRequiredError) {
        this.requireVerification();
      } else if (
        error instanceof CheckoutOfferChangedError ||
        error instanceof CheckoutCharterChangedError
      ) {
        if (error.code.endsWith('INVALID') && !isNewAttempt) {
          this.requireVerification();
          throw new CheckoutReconciliationRequiredError();
        }
        // New-input validation and prepare failures occur before creating an operation or calling Stripe.
        this.complete(fingerprint, idempotencyKey);
      }
      throw error;
    }
    this.complete(fingerprint, idempotencyKey);
    return result;
  }

  private complete(fingerprint: string, idempotencyKey: string): void {
    this.keys.delete(fingerprint);
    const completed = this.readStoredAttempts();
    if (completed[fingerprint] === idempotencyKey) {
      delete completed[fingerprint];
      this.writeStoredAttempts(completed);
    }
    this.offers.forget(fingerprint);
    this.expiresAt.delete(fingerprint);
  }

  private requireVerification(): void {
    this.verificationRequired = true;
    try {
      this.getStorage()?.setItem(verificationStorageKey, 'true');
    } catch {
      // Retain the block in memory when browser storage is restricted.
    }
  }

  private readStoredAttempts(): Record<string, string> {
    let serialized: string | null | undefined;
    try {
      serialized = this.getStorage()?.getItem(storageKey);
      if (!serialized) return {};
      const parsed: unknown = JSON.parse(serialized);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error('Invalid Checkout recovery cache.');
      const entries: Record<string, string> = {};
      const expired: string[] = [];
      for (const [fingerprint, value] of Object.entries(parsed)) {
        const entry = value as {
          idempotencyKey?: unknown;
          expiresAt?: unknown;
        } | null;
        if (
          !fingerprintPattern.test(fingerprint) ||
          !entry ||
          typeof entry.idempotencyKey !== 'string' ||
          !attemptKeyPattern.test(entry.idempotencyKey) ||
          !Number.isSafeInteger(entry.expiresAt) ||
          (entry.expiresAt as number) >
            Date.now() + CHECKOUT_RECOVERY_RETENTION_MS
        )
          throw new Error('Invalid Checkout recovery entry.');
        if ((entry.expiresAt as number) <= Date.now())
          expired.push(fingerprint);
        else {
          entries[fingerprint] = entry.idempotencyKey;
          this.expiresAt.set(fingerprint, entry.expiresAt as number);
        }
      }
      if (expired.length) {
        this.requireVerification();
        // Keep the block before pruning expired public terms and opaque attempt ids.
        if (this.getStorage()?.getItem(verificationStorageKey) === 'true') {
          this.writeStoredAttempts(entries);
          for (const fingerprint of expired) {
            this.keys.delete(fingerprint);
            this.expiresAt.delete(fingerprint);
            this.offers.forget(fingerprint);
          }
        }
      }
      return entries;
    } catch {
      if (serialized) this.requireVerification();
      return {};
    }
  }

  private writeStoredAttempts(attempts: Record<string, string>): boolean {
    try {
      const storage = this.getStorage();
      if (!storage) return false;
      if (Object.keys(attempts).length === 0) {
        storage.removeItem(storageKey);
        return storage.getItem(storageKey) === null;
      }
      const serialized = JSON.stringify(
        Object.fromEntries(
          Object.entries(attempts).map(([fingerprint, idempotencyKey]) => [
            fingerprint,
            { idempotencyKey, expiresAt: this.expiresAt.get(fingerprint) }
          ])
        )
      );
      if (storage.getItem(storageKey) === serialized) return true;
      storage.setItem(storageKey, serialized);
      return storage.getItem(storageKey) === serialized;
    } catch {
      // Restricted storage still allows retries during this service's lifetime.
      return false;
    }
  }
}
