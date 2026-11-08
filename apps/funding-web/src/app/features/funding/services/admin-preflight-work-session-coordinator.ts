import {
  DestroyRef,
  Injectable,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import type {
  AdminPreflightWorkSession,
  AdminPreflightWorkSessionCheckpoint,
  AdminPreflightWorkSessionCommandRequest,
  AdminPreflightWorkSessionFilters,
  AdminPreflightWorkSessionStartRequest,
  AdminPreflightWorkSessionSummary,
  AdminServicePreparationReceipt
} from '@openg7/funding-core';

import en from '../../../../assets/i18n/admin-preflight-work-session.en.json' with { type: 'json' };
import fr from '../../../../assets/i18n/admin-preflight-work-session.fr-CA.json' with { type: 'json' };

import { FundingAdminService } from './funding-admin.service.js';
import { FundingI18nService } from './funding-i18n.service.js';
import { AdminDashboardRequestError } from './funding-admin-session.js';
import { fundingAdminIdentityKey } from './funding-admin-identity-key.js';

type Pending =
  | { kind: 'start'; body: AdminPreflightWorkSessionStartRequest }
  | {
      kind: 'command';
      id: string;
      body: AdminPreflightWorkSessionCommandRequest;
    };

/** Personal progress only. All business decisions, drafts and delivery facts retain their existing owners. */
@Injectable()
export class AdminPreflightWorkSessionCoordinator {
  readonly admin = inject(FundingAdminService);
  private readonly i18n = inject(FundingI18nService);
  readonly current = signal<AdminPreflightWorkSession | null>(null);
  readonly recent = signal<readonly AdminPreflightWorkSessionSummary[]>([]);
  readonly state = signal<'loading' | 'ready' | 'unavailable' | 'forbidden'>(
    'loading'
  );
  readonly busy = signal(false);
  readonly error = signal<
    'conflict' | 'uncertain' | 'unavailable' | 'forbidden' | null
  >(null);
  readonly unresolved = signal(false);
  readonly checkedCommand = signal<{
    requestId: string;
    status: 'applied' | 'not_found';
  } | null>(null);
  private pending: Pending | null = null;
  private serial = 0;
  private request?: AbortController;
  private disposed = false;
  private identity = this.identityKey();

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { preflightWorkSession: language === 'en' ? en : fr }
        })
      );
    });
    effect(() => {
      const identity = this.identityKey();
      untracked(() => {
        if (identity === this.identity) return;
        this.identity = identity;
        ++this.serial;
        this.request?.abort();
        this.current.set(null);
        this.recent.set([]);
        this.pending = null;
        this.checkedCommand.set(null);
        this.unresolved.set(false);
        this.busy.set(false);
        this.error.set(null);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      ++this.serial;
      this.request?.abort();
    });
  }
  identityKey(): string {
    return fundingAdminIdentityKey(this.admin);
  }
  permitted(): boolean {
    return (
      this.admin.hasValidAdminSession() &&
      this.admin.identity()?.role !== 'reader'
    );
  }
  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.preflightWorkSession.' + key, params);
  }
  async load(
    id?: string,
    reconcile = false,
    requestId?: string
  ): Promise<boolean> {
    if (this.disposed || this.busy() || !this.permitted()) {
      if (!this.permitted()) this.state.set('forbidden');
      return false;
    }
    const ticket = ++this.serial,
      identity = this.identityKey();
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.state.set('loading');
    this.checkedCommand.set(null);
    try {
      const state = await this.admin.preflightWorkSessions.read(
        id,
        requestId ?? (reconcile ? this.pending?.body.requestId : undefined),
        request.signal
      );
      if (!this.valid(ticket, identity)) return false;
      this.current.set(state.current);
      this.checkedCommand.set(state.command);
      this.recent.set(state.recent);
      this.state.set('ready');
      if (
        !this.pending ||
        (reconcile &&
          state.command?.status === 'applied' &&
          state.command.requestId === this.pending.body.requestId)
      ) {
        this.pending = null;
        this.unresolved.set(false);
        this.error.set(null);
      }
      return true;
    } catch (error) {
      if (!this.valid(ticket, identity) || request.signal.aborted) return false;
      const status = this.status(error);
      if (status === 401 || status === 403 || status === 404)
        this.current.set(null);
      this.state.set(
        status === 401 || status === 403 ? 'forbidden' : 'unavailable'
      );
      this.error.set(
        status === 401 || status === 403 ? 'forbidden' : 'unavailable'
      );
      return false;
    }
  }
  item(contributionId: string, obligationId: string) {
    return this.current()?.items.find(
      (item) =>
        item.contributionId === contributionId &&
        item.obligationId === obligationId
    );
  }
  async start(
    receipt: AdminServicePreparationReceipt,
    filters: AdminPreflightWorkSessionFilters
  ): Promise<boolean> {
    if (!this.permitted() || this.busy() || this.unresolved()) return false;
    return this.mutate({
      kind: 'start',
      body: {
        requestId: crypto.randomUUID(),
        contributionId: receipt.contributionId,
        obligationId: receipt.service.id,
        filters
      }
    });
  }
  async command(
    action: AdminPreflightWorkSessionCommandRequest['action'],
    input: {
      contributionId?: string;
      obligationId?: string;
      observedVersion?: string;
      checkpoint?: AdminPreflightWorkSessionCheckpoint;
      filters?: AdminPreflightWorkSessionFilters;
    } = {}
  ): Promise<boolean> {
    const session = this.current();
    if (
      !session ||
      !this.permitted() ||
      this.busy() ||
      this.unresolved() ||
      this.error() === 'conflict'
    )
      return false;
    return this.mutate({
      kind: 'command',
      id: session.id,
      body: {
        requestId: crypto.randomUUID(),
        expectedRevision: session.revision,
        action,
        ...input
      }
    });
  }
  /** Explicit recovery reuses exactly the same request id and payload. Never called automatically. */
  async retryPending(): Promise<boolean> {
    return this.canRetryPending() && this.pending
      ? this.mutate(this.pending)
      : false;
  }
  canRetryPending(): boolean {
    const checked = this.checkedCommand();
    return (
      !!this.pending &&
      !this.busy() &&
      checked?.status === 'not_found' &&
      checked.requestId === this.pending.body.requestId
    );
  }
  adopt(session: AdminPreflightWorkSession | null): void {
    if (session) this.current.set(session);
  }
  private async mutate(pending: Pending): Promise<boolean> {
    const ticket = ++this.serial,
      identity = this.identityKey();
    this.request?.abort();
    this.pending = pending;
    this.checkedCommand.set(null);
    this.busy.set(true);
    this.error.set(null);
    try {
      const result =
        pending.kind === 'start'
          ? await this.admin.preflightWorkSessions.start(pending.body)
          : await this.admin.preflightWorkSessions.command(
              pending.id,
              pending.body
            );
      if (!this.valid(ticket, identity)) return false;
      this.current.set(result);
      this.recent.update((items) => [
        result,
        ...items.filter((item) => item.id !== result.id)
      ]);
      this.state.set('ready');
      this.pending = null;
      this.unresolved.set(false);
      return true;
    } catch (error) {
      if (!this.valid(ticket, identity)) return false;
      const status = this.status(error);
      if (status === 401 || status === 403) {
        this.current.set(null);
        this.error.set('forbidden');
        this.pending = null;
      } else if (status === 409) {
        this.error.set('conflict');
        this.pending = null;
      } else {
        this.error.set('uncertain');
        this.unresolved.set(true);
      }
      return false;
    } finally {
      if (this.valid(ticket, identity)) this.busy.set(false);
    }
  }
  private valid(ticket: number, identity: string): boolean {
    return (
      !this.disposed &&
      ticket === this.serial &&
      identity === this.identityKey()
    );
  }
  private status(error: unknown): number {
    return error instanceof AdminDashboardRequestError ? error.status : 0;
  }
}
