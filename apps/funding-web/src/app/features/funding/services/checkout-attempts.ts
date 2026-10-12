import type {
  CheckoutRequest,
  CheckoutResult,
  SponsorshipOfferQuote
} from '@openg7/funding-core';
import { normalizeSponsorshipOfferFormats } from '@openg7/funding-core';

import { parseContributionMinor } from '../models/funding-home.utils.js';

import {
  CheckoutReconciliationRequiredError,
  CheckoutOfferChangedError,
  CheckoutCharterChangedError
} from './checkout-error.js';
import {
  CheckoutOfferRecovery,
  type CheckoutAttemptStorage,
  type CheckoutOfferResume
} from './checkout-offer-recovery.js';

type CheckoutIntent = Omit<CheckoutRequest, 'idempotencyKey'>;

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
  private readonly offers: CheckoutOfferRecovery;

  constructor(
    private readonly getStorage: () => CheckoutAttemptStorage | null = () =>
      null
  ) {
    this.offers = new CheckoutOfferRecovery(getStorage);
  }

  async retainedSponsorshipOffer(
    amountMinor: number,
    currency: string
  ): Promise<CheckoutOfferResume> {
    const resume = await this.offers.resume(amountMinor, currency, {
      ...this.readStoredAttempts(),
      ...Object.fromEntries(this.keys)
    });
    if (resume.state === 'verification_required') this.requireVerification();
    return resume;
  }

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
    execute: (request: CheckoutRequest) => Promise<CheckoutResult>,
    offerQuote?: SponsorshipOfferQuote
  ): Promise<CheckoutResult> {
    const formats = normalizeSponsorshipOfferFormats(intent.offerFormats);
    const base = { ...intent };
    delete base.offerFormats;
    intent = { ...base, ...(formats ? { offerFormats: formats } : {}) };
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
        : []),
      ...(intent.offerFormats ? [intent.offerFormats] : [])
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
    this.writeStoredAttempts({ ...remembered, [fingerprint]: idempotencyKey });
    if (offerQuote && intent.contributionType === 'sponsorship_interest')
      this.offers.capture(
        fingerprint,
        idempotencyKey,
        offerQuote,
        intent.offerFormats
      );

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
