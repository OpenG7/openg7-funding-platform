import { signal } from '@angular/core';
import type { AdminSearchResponse } from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export interface AdminGlobalSearchPorts {
  readonly admin: Pick<FundingAdminService, 'search'>;
  token(): string;
  onSessionExpired(): void | Promise<void>;
}

/** Owns transient private queries and reads; the component owns dialog and focus. */
export class AdminGlobalSearchController {
  readonly query = signal('');
  readonly result = signal<AdminSearchResponse | null>(null);
  readonly state = signal<
    | 'idle'
    | 'loading'
    | 'ready'
    | 'error'
    | 'forbidden'
    | 'limited'
    | 'unavailable'
  >('idle');
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private generation = 0;
  private disposed = false;

  constructor(private readonly ports: AdminGlobalSearchPorts) {}

  changed(value: string): void {
    if (this.disposed) return;
    this.cancel();
    this.query.set(value);
    this.result.set(null);
    if (value.trim().length < 2) {
      this.state.set('idle');
      return;
    }
    this.state.set('loading');
    this.timer = setTimeout(() => void this.search(1), 300);
  }

  async search(page = 1): Promise<void> {
    if (this.disposed) return;
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.result.set(null);
    this.state.set('loading');
    try {
      const token = this.ports.token();
      if (!token) throw new AdminDashboardRequestError(401);
      const response = await this.ports.admin.search(
        token,
        { query: this.query().trim(), page, pageSize: 10 },
        controller.signal
      );
      if (!this.current(generation)) return;
      if (!this.ports.token()) throw new AdminDashboardRequestError(401);
      this.result.set(response);
      this.state.set(response.available ? 'ready' : 'unavailable');
    } catch (error) {
      if (!this.current(generation)) return;
      this.result.set(null);
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      if (status === 401) {
        this.clear();
        await this.ports.onSessionExpired();
      } else if (status === 403) {
        this.clear();
        this.state.set('forbidden');
      } else {
        this.state.set(status === 429 ? 'limited' : 'error');
      }
    } finally {
      if (this.current(generation)) this.controller = undefined;
    }
  }

  clear(): void {
    this.cancel();
    this.query.set('');
    this.result.set(null);
    this.state.set('idle');
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private cancel(): void {
    ++this.generation;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
}
