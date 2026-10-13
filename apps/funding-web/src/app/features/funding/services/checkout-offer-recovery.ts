import {
  normalizeSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferFormats,
  type SponsorshipOfferQuote,
  type SponsorshipOfferFormatOptions
} from '@openg7/funding-core';

import { CheckoutRecoveryUnavailableError } from './checkout-error.js';
import {
  CHECKOUT_RECOVERY_RETENTION_MS,
  CHECKOUT_OFFER_STORAGE_KEY,
  checkoutAttemptKeyPattern as attemptKeyPattern,
  checkoutFingerprintPattern as fingerprintPattern,
  type CheckoutAttemptStorage
} from './checkout-recovery-storage.js';

export {
  CHECKOUT_RECOVERY_RETENTION_MS,
  type CheckoutAttemptStorage
} from './checkout-recovery-storage.js';
export type CheckoutOfferResume =
  | { readonly state: 'none' }
  | {
      readonly state: 'retained';
      readonly quote: SponsorshipOfferQuote;
      readonly formats?: SponsorshipOfferFormatOptions;
    }
  | { readonly state: 'unavailable' }
  | { readonly state: 'verification_required' };
interface RetainedOffer {
  readonly idempotencyKey: string;
  readonly expiresAt: number;
  readonly quote: SponsorshipOfferQuote;
  readonly formats?: SponsorshipOfferFormatOptions;
}
const storageKey = CHECKOUT_OFFER_STORAGE_KEY;
// A client recovery window, not an expiry or a delivery deadline in the contract.
const retentionMs = CHECKOUT_RECOVERY_RETENTION_MS;
class RecoveryStorageUnavailable extends Error {}

/** Retain public terms only; an incomplete recovery cannot create a fresh payment attempt. */
export class CheckoutOfferRecovery {
  private readonly memory = new Map<string, RetainedOffer>();
  constructor(
    private readonly getStorage: () => CheckoutAttemptStorage | null
  ) {}

  capture(
    fingerprint: string,
    idempotencyKey: string,
    quote: SponsorshipOfferQuote,
    formats?: SponsorshipOfferFormatOptions
  ): boolean {
    const normalized = structuredClone(this.normalizeQuote(quote));
    const prior = this.memory.get(fingerprint);
    const entry = {
      idempotencyKey,
      quote: normalized,
      ...(formats
        ? { formats: normalizeSponsorshipOfferFormats(formats) }
        : {}),
      expiresAt: prior?.expiresAt ?? Date.now() + retentionMs
    };
    this.memory.set(fingerprint, entry);
    try {
      const entries = this.read();
      const saved = entries[fingerprint];
      if (
        saved &&
        saved.idempotencyKey === idempotencyKey &&
        saved.quote.fingerprint === quote.fingerprint &&
        saved.expiresAt > Date.now()
      ) {
        this.memory.set(fingerprint, saved);
        return true;
      }
      if (saved) return false;
      return this.write({ ...entries, [fingerprint]: entry });
    } catch {
      return false;
    }
  }

  async resume(
    amountMinor: number,
    currency: string,
    attempts: Record<string, string>
  ): Promise<CheckoutOfferResume> {
    let entries: Record<string, RetainedOffer>;
    try {
      entries = { ...Object.fromEntries(this.memory), ...this.read() };
    } catch (error) {
      if (!(error instanceof RecoveryStorageUnavailable))
        return { state: 'verification_required' };
      entries = Object.fromEntries(this.memory);
      if (!Object.keys(entries).length) return { state: 'unavailable' };
    }
    if (!Object.keys(entries).length)
      return {
        state: Object.keys(attempts).length
          ? 'verification_required'
          : this.canPersist()
            ? 'none'
            : 'unavailable'
      };
    for (const [fingerprint, entry] of Object.entries(entries)) {
      if (
        attempts[fingerprint] !== entry.idempotencyKey ||
        entry.expiresAt <= Date.now() ||
        !(await this.validChecksum(entry.quote))
      )
        return { state: 'verification_required' };
    }
    const retained = Object.values(entries);
    if (retained.length !== 1 || retained[0]!.quote.currency !== currency)
      return { state: 'verification_required' };
    // Even the form's default amount after reload cannot requote an uncertain operation.
    return {
      state: 'retained',
      quote: retained[0]!.quote,
      ...(retained[0]!.formats ? { formats: retained[0]!.formats } : {})
    };
  }

  async acceptsIntent(
    fingerprint: string,
    acceptance: { version: string; fingerprint: string } | undefined,
    attempts: Record<string, string>
  ): Promise<boolean> {
    let entries: Record<string, RetainedOffer>;
    try {
      entries = { ...Object.fromEntries(this.memory), ...this.read() };
    } catch (error) {
      if (!(error instanceof RecoveryStorageUnavailable)) return false;
      entries = Object.fromEntries(this.memory);
      if (!Object.keys(entries).length) {
        if (acceptance && !Object.keys(attempts).length)
          throw new CheckoutRecoveryUnavailableError();
        return !acceptance;
      }
    }
    if (!Object.keys(entries).length)
      return !acceptance || !Object.keys(attempts).length;
    if (!acceptance) return false;
    const retained = entries[fingerprint];
    return (
      !!retained &&
      retained.idempotencyKey === attempts[fingerprint] &&
      retained.expiresAt > Date.now() &&
      retained.quote.version === acceptance.version &&
      retained.quote.fingerprint === acceptance.fingerprint &&
      (await this.validChecksum(retained.quote))
    );
  }

  ownerMatches(fingerprint: string, idempotencyKey: string): boolean {
    try {
      const saved = this.read()[fingerprint];
      if (saved) return saved.idempotencyKey === idempotencyKey;
    } catch (error) {
      if (!(error instanceof RecoveryStorageUnavailable)) return false;
    }
    const remembered = this.memory.get(fingerprint);
    return !remembered || remembered.idempotencyKey === idempotencyKey;
  }

  /** Read-only expiry facts; removal stays inside the attempt coordinator. */
  expiredOwners(): Readonly<Record<string, string>> {
    let entries: Record<string, RetainedOffer>;
    try {
      entries = { ...Object.fromEntries(this.memory), ...this.read() };
    } catch (error) {
      if (!(error instanceof RecoveryStorageUnavailable)) return {};
      entries = Object.fromEntries(this.memory);
    }
    return Object.fromEntries(
      Object.entries(entries)
        .filter(([, entry]) => entry.expiresAt <= Date.now())
        .map(([fingerprint, entry]) => [fingerprint, entry.idempotencyKey])
    );
  }

  forget(fingerprint: string, idempotencyKey: string, persist = true): void {
    if (this.memory.get(fingerprint)?.idempotencyKey === idempotencyKey)
      this.memory.delete(fingerprint);
    if (!persist) return;
    try {
      const entries = this.read();
      if (entries[fingerprint]?.idempotencyKey !== idempotencyKey) return;
      delete entries[fingerprint];
      this.write(entries);
    } catch {
      // An unreadable residual cache will require verification on reload.
    }
  }

  private normalizeQuote(value: unknown): SponsorshipOfferQuote {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid retained offer.');
    const { fingerprint, ...terms } = value as Record<string, unknown>;
    const snapshot = normalizeSponsorshipOfferSnapshot(terms);
    if (
      typeof fingerprint !== 'string' ||
      !fingerprintPattern.test(fingerprint)
    )
      throw new Error('Invalid retained offer fingerprint.');
    return { ...snapshot, fingerprint };
  }

  private async validChecksum(quote: SponsorshipOfferQuote): Promise<boolean> {
    const { fingerprint, ...terms } = quote;
    const bytes = new TextEncoder().encode(
      JSON.stringify(normalizeSponsorshipOfferSnapshot(terms))
    );
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return (
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('') === fingerprint
    );
  }

  private read(): Record<string, RetainedOffer> {
    let serialized: string | null | undefined;
    try {
      serialized = this.getStorage()?.getItem(storageKey);
    } catch {
      throw new RecoveryStorageUnavailable();
    }
    if (!serialized) return {};
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Invalid offer recovery cache.');
    const entries: Record<string, RetainedOffer> = {};
    for (const [fingerprint, value] of Object.entries(parsed)) {
      const entry = value as Partial<RetainedOffer> | null;
      if (
        !fingerprintPattern.test(fingerprint) ||
        !entry ||
        typeof entry.idempotencyKey !== 'string' ||
        !attemptKeyPattern.test(entry.idempotencyKey) ||
        !Number.isSafeInteger(entry.expiresAt) ||
        entry.expiresAt! > Date.now() + retentionMs
      )
        throw new Error('Invalid offer recovery entry.');
      entries[fingerprint] = {
        idempotencyKey: entry.idempotencyKey,
        expiresAt: entry.expiresAt!,
        quote: this.normalizeQuote(entry.quote),
        ...(entry.formats === undefined
          ? {}
          : { formats: normalizeSponsorshipOfferFormats(entry.formats) })
      };
    }
    return entries;
  }

  private canPersist(): boolean {
    const probeKey =
      'openg7.checkout-recovery-probe.' + globalThis.crypto.randomUUID();
    let storage: CheckoutAttemptStorage | null = null;
    try {
      storage = this.getStorage();
      if (!storage) return false;
      storage.setItem(probeKey, '1');
      const persisted = storage.getItem(probeKey) === '1';
      storage.removeItem(probeKey);
      return persisted;
    } catch {
      return false;
    } finally {
      try {
        storage?.removeItem(probeKey);
      } catch {
        /* The probe contains no recovery data. */
      }
    }
  }

  private write(entries: Record<string, RetainedOffer>): boolean {
    const storage = this.getStorage();
    if (!storage) return false;
    if (Object.keys(entries).length) {
      const serialized = JSON.stringify(entries);
      storage.setItem(storageKey, serialized);
      return storage.getItem(storageKey) === serialized;
    }
    storage.removeItem(storageKey);
    return storage.getItem(storageKey) === null;
  }
}
