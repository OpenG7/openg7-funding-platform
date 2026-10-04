import { signal } from '@angular/core';
import type { AdminSetupStatusResponse } from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export interface AdminSetupReadPorts {
  readonly admin: Pick<FundingAdminService, 'getSetupStatus'>;
  token(): string;
  t(key: string, params?: Record<string, unknown>): string;
  onAccessDenied(status: 401 | 403): void;
}

/** Owns the configuration read lifetime; navigation and cockpit reads stay on the page. */
export class AdminSetupReadController {
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly setup = signal<AdminSetupStatusResponse | null>(null);
  readonly accessError = signal('');
  readonly refreshKey = signal(0);
  private generation = 0;
  private disposed = false;

  constructor(private readonly ports: AdminSetupReadPorts) {}

  async load(): Promise<AdminSetupStatusResponse | null> {
    if (this.disposed) return null;
    const generation = ++this.generation;
    this.state.set('loading');
    this.setup.set(null);
    this.accessError.set('');
    try {
      const setup = await this.ports.admin.getSetupStatus(this.ports.token());
      if (!this.current(generation)) return null;
      this.setup.set(setup);
      this.refreshKey.update((value) => value + 1);
      this.state.set('ready');
      return setup;
    } catch (error) {
      if (!this.current(generation)) return null;
      if (
        error instanceof AdminDashboardRequestError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.rejectAccess(error.status);
      }
      this.state.set('error');
      return null;
    }
  }

  rejectAccess(status: 401 | 403): void {
    if (this.disposed) return;
    ++this.generation;
    this.setup.set(null);
    this.accessError.set(
      this.ports.t(
        status === 401
          ? 'admin.setupEmail.expired'
          : 'admin.setupEmail.forbidden'
      )
    );
    this.ports.onAccessDenied(status);
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
}
