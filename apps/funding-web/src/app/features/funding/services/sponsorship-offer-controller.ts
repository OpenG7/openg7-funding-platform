import { computed, signal } from '@angular/core';
import type { SponsorshipOfferQuote } from '@openg7/funding-core';

import type { CheckoutOfferResume } from './checkout-offer-recovery.js';

export interface SponsorshipOfferPorts {
  quote(
    amountMinor: number,
    currency: string,
    signal: AbortSignal
  ): Promise<SponsorshipOfferQuote>;
  resume(amountMinor: number, currency: string): Promise<CheckoutOfferResume>;
}

/** One form's server offer; changing context revokes acceptance without replacing a submitted attempt. */
export class SponsorshipOfferController {
  readonly quote = signal<SponsorshipOfferQuote | null>(null);
  readonly state = signal<
    | 'idle'
    | 'loading'
    | 'ready'
    | 'error'
    | 'recovery_unavailable'
    | 'verification_required'
  >('idle');
  readonly accepted = signal(false);
  readonly retained = signal(false);
  readonly ready = computed(
    () => this.state() === 'ready' && !!this.quote() && this.accepted()
  );
  private generation = 0;
  private abort: AbortController | null = null;
  private disposed = false;

  constructor(private readonly ports: SponsorshipOfferPorts) {}

  async load(
    amountMinor: number | null,
    currency: string,
    forceFresh = false
  ): Promise<void> {
    const generation = ++this.generation;
    this.abort?.abort();
    this.abort = null;
    this.quote.set(null);
    this.accepted.set(false);
    this.retained.set(false);
    this.state.set('idle');
    if (this.disposed || amountMinor === null) return;
    this.state.set('loading');
    const abort = new AbortController();
    this.abort = abort;
    try {
      if (!forceFresh) {
        const resume = await this.ports.resume(amountMinor, currency);
        if (this.disposed || generation !== this.generation) return;
        if (resume.state === 'verification_required') {
          this.state.set('verification_required');
          return;
        }
        if (resume.state === 'unavailable') {
          this.state.set('recovery_unavailable');
          return;
        }
        if (resume.state === 'retained') {
          this.quote.set(resume.quote);
          this.retained.set(true);
          this.state.set('ready');
          return;
        }
      }
      const quote = await this.ports.quote(amountMinor, currency, abort.signal);
      if (this.disposed || generation !== this.generation) return;
      if (quote.amountMinor !== amountMinor || quote.currency !== currency)
        throw new Error('Offer context changed.');
      this.quote.set(quote);
      this.state.set('ready');
    } catch {
      if (!this.disposed && generation === this.generation)
        this.state.set('error');
    }
  }

  accept(accepted: boolean): void {
    this.accepted.set(this.state() === 'ready' && accepted);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.abort?.abort();
  }
}
