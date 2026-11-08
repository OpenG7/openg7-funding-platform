import { signal } from '@angular/core';

import type { PreflightPreparationsView } from '../../services/funding-admin-preflight.client.js';

export type PreflightViewError = 'forbidden' | 'unavailable';
interface PreparationPort {
  read(id: string): Promise<PreflightPreparationsView>;
  permitted(): boolean;
  identity(): string;
}
/** Selection and identity fencing prevent an older dossier response from revealing private work. */
export class AdminPreflightPreparationsController {
  readonly data = signal<PreflightPreparationsView | null>(null);
  readonly loading = signal(false);
  readonly error = signal<PreflightViewError | null>(null);
  private id = '';
  private identity = '';
  private serial = 0;
  private disposed = false;
  constructor(private readonly port: PreparationPort) {}
  select(id: string, identity: string): void {
    if (id !== this.id || identity !== this.identity) {
      ++this.serial;
      this.data.set(null);
      this.error.set(null);
      this.loading.set(false);
    }
    this.id = id;
    this.identity = identity;
    void this.load();
  }
  async load(): Promise<void> {
    const ticket = ++this.serial,
      id = this.id,
      identity = this.identity;
    if (
      this.disposed ||
      !id ||
      !this.port.permitted() ||
      identity !== this.port.identity()
    ) {
      this.data.set(null);
      this.loading.set(false);
      this.error.set('forbidden');
      return;
    }
    this.data.set(null);
    this.error.set(null);
    this.loading.set(true);
    try {
      const data = await this.port.read(id);
      if (!this.current(ticket, id, identity)) return;
      this.data.set(data);
    } catch (error) {
      if (!this.current(ticket, id, identity)) return;
      const status = (error as { status?: number })?.status;
      this.error.set(
        status === 401 || status === 403 ? 'forbidden' : 'unavailable'
      );
    } finally {
      if (ticket === this.serial && !this.disposed) this.loading.set(false);
    }
  }
  private current(ticket: number, id: string, identity: string): boolean {
    return (
      !this.disposed &&
      ticket === this.serial &&
      id === this.id &&
      identity === this.identity &&
      identity === this.port.identity() &&
      this.port.permitted()
    );
  }
  dispose(): void {
    this.disposed = true;
    ++this.serial;
    this.data.set(null);
    this.loading.set(false);
  }
}
