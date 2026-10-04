import { signal } from '@angular/core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import type {
  AdminAccessAccount,
  AdminAccessResponse,
  FundingAdminService
} from '../../services/funding-admin.service.js';

import type { AdminAccessFieldChange } from './admin-access-presentation.types.js';

export interface AdminAccessPorts {
  readonly admin: Pick<FundingAdminService, 'accessAccounts' | 'updateAccess'>;
  onSessionExpired(): void;
  restoreRevokeFocus(sessionId: string | null): void;
}

/** Account drafts and confirmed access changes; navigation and focus belong to the page. */
export class AdminAccessController {
  readonly data = signal<AdminAccessResponse | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly pendingSession = signal<string | null>(null);
  readonly confirmed = signal(false);
  readonly draft = signal<AdminAccessAccount>({
    id: '',
    subject: '',
    displayName: '',
    role: 'reader',
    disabled: false
  });
  private disposed = false;

  constructor(private readonly ports: AdminAccessPorts) {}

  dispose(): void {
    this.disposed = true;
  }

  async load(): Promise<void> {
    if (this.disposed) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await this.ports.admin.accessAccounts();
      if (this.disposed) return;
      this.data.set(response);
    } catch (error) {
      if (!this.disposed) this.handleError(error);
    } finally {
      if (!this.disposed) this.busy.set(false);
    }
  }

  edit(account: AdminAccessAccount): void {
    if (this.disposed) return;
    this.draft.set({ ...account });
    this.confirmed.set(false);
  }

  newAccount(): void {
    if (this.disposed) return;
    this.draft.set({
      id: '',
      subject: '',
      displayName: '',
      role: 'reader',
      disabled: false
    });
    this.confirmed.set(false);
  }

  changeField(change: AdminAccessFieldChange): void {
    if (this.disposed) return;
    this.draft.update((draft) => ({ ...draft, [change.field]: change.value }));
    this.confirmed.set(false);
  }

  selectSession(sessionId: string): void {
    if (this.disposed) return;
    this.pendingSession.set(sessionId);
  }

  cancelRevoke(): void {
    if (this.disposed || this.busy()) return;
    const sessionId = this.pendingSession();
    this.pendingSession.set(null);
    this.ports.restoreRevokeFocus(sessionId);
  }

  async save(): Promise<void> {
    if (this.disposed || !this.confirmed() || this.busy()) return;
    const draft = this.draft();
    await this.change({ ...draft, confirmation: draft.subject });
    if (!this.disposed) this.confirmed.set(false);
  }

  async revoke(sessionId: string): Promise<void> {
    if (this.disposed || this.busy() || this.pendingSession() !== sessionId)
      return;
    await this.change({ sessionId, confirmation: sessionId });
    this.cancelRevoke();
  }

  private async change(
    input: (AdminAccessAccount | { sessionId: string }) & {
      confirmation: string;
    }
  ): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.ports.admin.updateAccess(input);
      if (this.disposed) return;
      await this.load();
    } catch (error) {
      if (!this.disposed) this.handleError(error);
    } finally {
      if (!this.disposed) this.busy.set(false);
    }
  }

  private handleError(error: unknown): void {
    if (
      error instanceof AdminDashboardRequestError &&
      [401, 403].includes(error.status)
    ) {
      this.data.set(null);
      this.pendingSession.set(null);
      this.newAccount();
      if (error.status === 401) {
        this.ports.onSessionExpired();
        return;
      }
      this.error.set('admin.access.ownerRequired');
      return;
    }
    this.error.set(
      error instanceof Error && error.message === 'LAST_OWNER'
        ? 'admin.access.lastOwner'
        : 'admin.access.error'
    );
  }
}
