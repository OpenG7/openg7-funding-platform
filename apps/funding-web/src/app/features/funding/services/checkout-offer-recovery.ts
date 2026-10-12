import {
  normalizeSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferFormats,
  type SponsorshipOfferQuote,
  type SponsorshipOfferFormatOptions
} from '@openg7/funding-core';

export type CheckoutAttemptStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;
export type CheckoutOfferResume =
  | { readonly state: 'none' }
  | {
      readonly state: 'retained';
      readonly quote: SponsorshipOfferQuote;
      readonly formats?: SponsorshipOfferFormatOptions;
    }
  | { readonly state: 'verification_required' };
interface RetainedOffer {
  readonly idempotencyKey: string;
  readonly expiresAt: number;
  readonly quote: SponsorshipOfferQuote;
  readonly formats?: SponsorshipOfferFormatOptions;
}
const storageKey = 'openg7.checkout-offer-recovery.v1';
const fingerprintPattern = /^[a-f0-9]{64}$/;
const attemptKeyPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
// A client recovery window, not an expiry or a delivery deadline in the contract.
const retentionMs = 24 * 60 * 60 * 1000;
class OfferStorageUnavailableError extends Error {}

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
  ): void {
    const normalized = structuredClone(this.normalizeQuote(quote));
    const entry = {
      idempotencyKey,
      quote: normalized,
      ...(formats
        ? { formats: normalizeSponsorshipOfferFormats(formats) }
        : {}),
      expiresAt: Date.now() + retentionMs
    };
    this.memory.set(fingerprint, entry);
    try {
      const entries = this.read();
      this.write({ ...entries, [fingerprint]: entry });
    } catch {
      // Restricted storage still preserves the exact offer within this service instance.
    }
  }

  async resume(
    amountMinor: number,
    currency: string,
    attempts: Record<string, string>
  ): Promise<CheckoutOfferResume> {
    let entries: Record<string, RetainedOffer>;
    try {
      entries = { ...this.read(), ...Object.fromEntries(this.memory) };
    } catch {
      const retained = [...this.memory.values()].find(
        (entry) =>
          entry.quote.amountMinor === amountMinor &&
          entry.quote.currency === currency
      );
      if (
        retained &&
        retained.expiresAt > Date.now() &&
        (await this.validChecksum(retained.quote))
      )
        return {
          state: 'retained',
          quote: retained.quote,
          ...(retained.formats ? { formats: retained.formats } : {})
        };
      return { state: 'verification_required' };
    }
    if (!Object.keys(entries).length)
      return {
        state: Object.keys(attempts).length ? 'verification_required' : 'none'
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
      entries = { ...this.read(), ...Object.fromEntries(this.memory) };
    } catch (error) {
      entries = Object.fromEntries(this.memory);
      // Personal support keeps its existing storage-denied behavior. An unreadable
      // sponsorship cache or a known retained offer still requires verification.
      if (!Object.keys(entries).length)
        return !acceptance && error instanceof OfferStorageUnavailableError;
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

  forget(fingerprint: string): void {
    this.memory.delete(fingerprint);
    try {
      const entries = this.read();
      delete entries[fingerprint];
      this.write(entries);
    } catch {
      // An unreadable residual cache will require verification on reload.
    }
  }

  private normalizeQuote(value: unknown): SponsorshipOfferQuote {
    const snapshot = normalizeSponsorshipOfferSnapshot(value);
    const fingerprint = (value as { fingerprint?: unknown }).fingerprint;
    if (
      typeof fingerprint !== 'string' ||
      !fingerprintPattern.test(fingerprint)
    )
      throw new Error('Invalid retained offer fingerprint.');
    return { ...snapshot, fingerprint };
  }

  private async validChecksum(quote: SponsorshipOfferQuote): Promise<boolean> {
    const bytes = new TextEncoder().encode(
      JSON.stringify(normalizeSponsorshipOfferSnapshot(quote))
    );
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return (
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('') === quote.fingerprint
    );
  }

  private read(): Record<string, RetainedOffer> {
    let serialized: string | null | undefined;
    try {
      serialized = this.getStorage()?.getItem(storageKey);
    } catch {
      throw new OfferStorageUnavailableError();
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

  private write(entries: Record<string, RetainedOffer>): void {
    const storage = this.getStorage();
    if (Object.keys(entries).length)
      storage?.setItem(storageKey, JSON.stringify(entries));
    else storage?.removeItem(storageKey);
  }
}
