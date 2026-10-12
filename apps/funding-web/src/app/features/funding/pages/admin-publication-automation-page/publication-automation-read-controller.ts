import { signal } from '@angular/core';
import type {
  PublicationAutomationFilter,
  PublicationAutomationState
} from '@openg7/funding-core';

import type { PublicationAutomationCommandContext } from './publication-automation.ports.js';

export interface PublicationAutomationReadTimer {
  schedule(
    callback: () => void,
    intervalMs: number
  ): ReturnType<typeof setInterval>;
  cancel(timer: ReturnType<typeof setInterval>): void;
}

/** Read dependencies and the existing panel guards, without page or drawer ownership. */
export interface PublicationAutomationReadPorts {
  api: {
    read(
      filter: PublicationAutomationFilter
    ): Promise<PublicationAutomationState>;
  };
  clearError(): void;
  showError(error: unknown): void;
  busy(): boolean;
  workerChanging(): boolean;
  selected(): boolean;
  composing(): boolean;
  settings(): boolean;
  timer?: PublicationAutomationReadTimer;
}

/** Authoritative read snapshot and navigation generations; commands retain their own workflow. */
export class PublicationAutomationReadController {
  readonly state = signal<PublicationAutomationState | null>(null);
  readonly sponsorshipId = signal<string | null>(null);
  readonly deliveryId = signal<string | null>(null);
  readonly queueOffset = signal(0);
  readonly requestedDeliveryMissing = signal(false);
  private loadGeneration = 0;
  private contextRevision = 0;
  private destroyed = false;
  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private readonly timer: PublicationAutomationReadTimer;

  constructor(private readonly ports: PublicationAutomationReadPorts) {
    this.timer = ports.timer ?? {
      schedule: (callback, intervalMs) => setInterval(callback, intervalMs),
      cancel: (timer) => clearInterval(timer)
    };
  }

  isDisposed(): boolean {
    return this.destroyed;
  }

  beginContext(
    filter: PublicationAutomationFilter
  ): PublicationAutomationCommandContext {
    if (this.destroyed)
      return { revision: this.contextRevision, filter: this.currentFilter() };
    this.contextRevision++;
    this.loadGeneration++;
    this.state.set(null);
    this.requestedDeliveryMissing.set(false);
    this.sponsorshipId.set(filter.sponsorshipId ?? null);
    this.deliveryId.set(filter.deliveryId ?? null);
    this.resetQueueOffset();
    return { revision: this.contextRevision, filter: this.currentFilter() };
  }

  captureCommandContext(): PublicationAutomationCommandContext {
    // The command owns the next confirmed snapshot, even if an older GET is pending.
    this.loadGeneration++;
    this.resetQueueOffset();
    return { revision: this.contextRevision, filter: this.currentFilter() };
  }

  isCurrent(context: PublicationAutomationCommandContext): boolean {
    return !this.destroyed && context.revision === this.contextRevision;
  }

  applyConfirmedState(next: PublicationAutomationState): void {
    if (this.destroyed) return;
    // Also invalidate reads started between command capture and its confirming GET.
    this.loadGeneration++;
    this.applyState(next);
  }

  resetQueueOffset(): void {
    this.queueOffset.set(0);
  }

  async loadQueuePage(offset: number): Promise<boolean> {
    if (this.destroyed || !Number.isSafeInteger(offset) || offset < 0)
      return false;
    const previousOffset = this.queueOffset();
    const revision = ++this.contextRevision;
    this.queueOffset.set(offset);
    const pending = this.load(true);
    const generation = this.loadGeneration;
    const loaded = await pending;
    if (
      !loaded &&
      !this.destroyed &&
      revision === this.contextRevision &&
      generation === this.loadGeneration
    )
      this.queueOffset.set(previousOffset);
    return loaded;
  }

  async load(preserveStateOnFailure = false): Promise<boolean> {
    if (this.destroyed) return false;
    const generation = ++this.loadGeneration;
    const filter = this.currentFilter();
    try {
      const next = await this.ports.api.read(filter);
      if (this.destroyed || generation !== this.loadGeneration) return false;
      this.applyState(next);
      this.ports.clearError();
      return true;
    } catch (error) {
      if (this.destroyed || generation !== this.loadGeneration) return false;
      if (!preserveStateOnFailure) this.state.set(null);
      this.ports.showError(error);
      return false;
    }
  }

  startPolling(): void {
    if (this.destroyed || this.pollingTimer !== undefined) return;
    this.pollingTimer = this.timer.schedule(() => {
      if (
        !this.destroyed &&
        !this.ports.busy() &&
        !this.ports.workerChanging() &&
        !this.ports.selected() &&
        !this.ports.composing() &&
        !this.ports.settings()
      )
        void this.load();
    }, 30000);
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadGeneration++;
    if (this.pollingTimer !== undefined) {
      this.timer.cancel(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  private currentFilter(): PublicationAutomationFilter {
    return {
      sponsorshipId: this.sponsorshipId() ?? undefined,
      deliveryId: this.deliveryId() ?? undefined,
      ...(this.queueOffset() ? { queueOffset: this.queueOffset() } : {})
    };
  }

  private applyState(next: PublicationAutomationState): void {
    this.state.set(next);
    this.requestedDeliveryMissing.set(
      Boolean(this.deliveryId()) &&
        !next.deliveries.some((delivery) => delivery.id === this.deliveryId())
    );
  }
}
