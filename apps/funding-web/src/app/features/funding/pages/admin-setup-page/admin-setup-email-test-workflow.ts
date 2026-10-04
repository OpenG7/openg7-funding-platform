import { computed, signal } from '@angular/core';
import type {
  AdminEmailTestResult,
  AdminSetupStatusResponse
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

import { projectReadiness } from './setup-projections.js';
import type {
  SetupEmailTestState,
  SetupEmailTestView
} from './setup-presentation.js';

export interface AdminSetupEmailTestPorts {
  readonly admin: Pick<FundingAdminService, 'sendEmailTest' | 'getEmailTest'>;
  readonly scope: string;
  token(): string;
  t(key: string, params?: Record<string, unknown>): string;
  storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  requestId(): string;
  onAccessDenied(status: 401 | 403): void;
}

/** Stores the request before sending and reconciles uncertain outcomes through server reads. */
export class AdminSetupEmailTestWorkflow {
  readonly email = signal('');
  readonly state = signal<SetupEmailTestState>('idle');
  readonly message = signal('');
  readonly result = signal<AdminEmailTestResult | null>(null);
  readonly requestId = signal<string | null>(null);
  readonly busy = computed(() =>
    ['submitting', 'checking'].includes(this.state())
  );
  readonly view = computed<SetupEmailTestView>(() => ({
    email: this.email(),
    state: this.state(),
    busy: this.busy(),
    message: this.message(),
    result: this.result(),
    requestId: this.requestId()
  }));
  private generation = 0;
  private disposed = false;
  private readonly storageKey: string;

  constructor(private readonly ports: AdminSetupEmailTestPorts) {
    this.storageKey = 'openg7-email-test:' + ports.scope;
  }

  defaultRecipient(setup: AdminSetupStatusResponse): void {
    if (!this.disposed && !this.email() && setup.email.admin_notification_email)
      this.email.set(setup.email.admin_notification_email);
  }

  async restore(): Promise<void> {
    if (this.disposed || this.busy()) return;
    let id: string | null;
    try {
      id = this.ports.storage()?.getItem(this.storageKey) ?? null;
    } catch {
      return;
    }
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    this.requestId.set(id);
    await this.check();
  }

  /** True only for a current, server-confirmed result, allowing the page to refresh setup. */
  async send(setup: AdminSetupStatusResponse | null): Promise<boolean> {
    if (
      this.disposed ||
      !setup ||
      !projectReadiness(setup).canSendEmailTest ||
      this.busy() ||
      this.state() === 'unknown'
    )
      return false;

    const requestId = this.result()
      ? this.ports.requestId()
      : (this.requestId() ?? this.ports.requestId());
    try {
      const storage = this.ports.storage();
      if (!storage) throw new Error('Session storage unavailable');
      storage.setItem(this.storageKey, requestId);
    } catch {
      this.message.set(this.ports.t('admin.setupEmail.storage'));
      return false;
    }
    const generation = ++this.generation;
    this.requestId.set(requestId);
    this.result.set(null);
    this.state.set('submitting');
    this.message.set('');
    try {
      const to =
        this.email().trim() ||
        setup.email.admin_notification_email ||
        undefined;
      const result = await this.ports.admin.sendEmailTest(this.ports.token(), {
        to,
        requestId
      });
      if (!this.current(generation)) return false;
      this.acceptResult(result);
      return true;
    } catch (error) {
      if (!this.current(generation)) return false;
      if (this.handleAccessError(error)) return false;
      if (
        error instanceof AdminDashboardRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 409
      ) {
        this.state.set('error');
        this.message.set(this.ports.t('admin.setupEmail.invalid'));
      } else this.state.set('unknown');
      return false;
    }
  }

  async check(): Promise<void> {
    const id = this.requestId();
    if (this.disposed || !id || this.busy()) return;
    const generation = ++this.generation;
    this.state.set('checking');
    this.message.set('');
    try {
      const result = await this.ports.admin.getEmailTest(
        this.ports.token(),
        id
      );
      if (this.current(generation)) this.acceptResult(result);
    } catch (error) {
      if (!this.current(generation) || this.handleAccessError(error)) return;
      if (error instanceof AdminDashboardRequestError && error.status === 404) {
        this.state.set('idle');
        this.message.set(this.ports.t('admin.setupEmail.notFound'));
      } else this.state.set('unknown');
    }
  }

  setEmail(email: string): void {
    if (this.disposed || this.busy() || this.state() === 'unknown') return;
    this.email.set(email);
    if (this.result()) {
      this.result.set(null);
      this.requestId.set(null);
      try {
        this.ports.storage()?.removeItem(this.storageKey);
      } catch {
        /* No pending outcome to recover. */
      }
    }
    this.state.set('idle');
    this.message.set('');
  }

  resetAccess(): void {
    if (this.disposed) return;
    ++this.generation;
    this.email.set('');
    this.result.set(null);
    this.message.set('');
    this.state.set('error');
    // Keep the persisted UUID: access loss cannot determine a pending send's outcome.
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private acceptResult(result: AdminEmailTestResult): void {
    this.result.set(result);
    this.email.set(result.to);
    this.state.set(result.status);
    this.message.set(
      result.status === 'failed'
        ? this.ports.t('admin.setupEmail.failedHelp')
        : ''
    );
  }

  private handleAccessError(error: unknown): boolean {
    if (
      !(error instanceof AdminDashboardRequestError) ||
      (error.status !== 401 && error.status !== 403)
    )
      return false;
    this.resetAccess();
    this.ports.onAccessDenied(error.status);
    return true;
  }
}
