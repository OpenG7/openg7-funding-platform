import { DestroyRef, Injectable, inject, signal } from '@angular/core';

import { FundingService } from './funding.service.js';

export type CheckoutNoticeStatus =
  'idle' | 'pending' | 'confirmed' | 'cancel' | 'failed' | 'expired';

/** Scoped to the funding page: one request at a time, with a bounded retry window. */
@Injectable()
export class CheckoutStatusMonitor {
  private readonly funding = inject(FundingService);
  private readonly destroyRef = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private reference: string | null = null;
  private attempts = 0;
  private deadline = 0;
  private initialStatus: 'pending' | 'cancel' = 'pending';

  readonly status = signal<CheckoutNoticeStatus>('idle');
  readonly paused = signal(false);
  readonly checking = signal(false);
  readonly canRetry = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => this.stop());
  }

  start(
    reference: string | null,
    initialStatus: 'pending' | 'cancel' = 'pending'
  ): void {
    this.stop();
    this.reference = reference;
    this.attempts = 0;
    this.deadline = Date.now() + 120_000;
    this.initialStatus = initialStatus;
    this.status.set(initialStatus);
    this.paused.set(false);
    this.canRetry.set(Boolean(reference));
    if (reference) void this.check(this.generation);
    else this.paused.set(true);
  }

  retry(): void {
    if (
      this.reference &&
      !this.checking() &&
      !['idle', 'confirmed'].includes(this.status())
    ) {
      this.start(this.reference, this.initialStatus);
    }
  }

  dismiss(): void {
    this.stop();
    this.status.set('idle');
  }

  cancel(reference: string | null = null): void {
    this.start(reference, 'cancel');
  }

  private stop(): void {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.request?.abort();
    this.request = null;
    this.checking.set(false);
  }

  private async check(generation: number): Promise<void> {
    if (!this.reference || !this.isCurrent(generation)) return;
    if (this.attempts >= 12 || Date.now() >= this.deadline) {
      this.paused.set(true);
      return;
    }
    this.attempts++;
    this.checking.set(true);
    const request = new AbortController();
    this.request = request;
    const timeout = setTimeout(
      () => request.abort(),
      Math.min(10_000, this.deadline - Date.now())
    );
    try {
      const result = await this.funding.lookupPublicReference(
        { reference: this.reference },
        request.signal
      );
      if (!this.isCurrent(generation) || request.signal.aborted) return;
      if (result.found && result.paymentStatus === 'paid') {
        this.status.set('confirmed');
      } else if (
        result.found &&
        (result.paymentStatus === 'failed' ||
          result.paymentStatus === 'expired')
      ) {
        this.status.set(result.paymentStatus);
      }
    } catch {
      // Failure never confirms a payment. A later request or manual retry can recover.
    } finally {
      clearTimeout(timeout);
      if (this.isCurrent(generation)) {
        this.request = null;
        this.checking.set(false);
        if (this.status() === 'pending') {
          if (this.attempts >= 12 || Date.now() >= this.deadline)
            this.paused.set(true);
          else
            this.timer = setTimeout(() => void this.check(generation), 5_000);
        }
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && !this.destroyRef.destroyed;
  }
}
