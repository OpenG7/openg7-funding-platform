import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  effect,
  inject,
  untracked
} from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import type {
  AdminCampaignItem,
  AdminCampaignsQuery
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from './funding-admin-session.js';
import { FundingAdminService } from './funding-admin.service.js';
import {
  adminCampaignsActions,
  adminCampaignsFeature,
  selectAdminCampaignsSelected
} from './admin-campaigns.store.js';

/** Route-scoped API orchestration over the single NgRx campaigns state. */
@Injectable()
export class AdminCampaignsStore {
  private readonly store = inject(Store);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly snapshot = this.store.selectSignal(
    adminCampaignsFeature.selectAdminCampaignsState
  );
  readonly query = this.store.selectSignal(adminCampaignsFeature.selectQuery);
  readonly data = this.store.selectSignal(adminCampaignsFeature.selectData);
  readonly state = this.store.selectSignal(adminCampaignsFeature.selectStatus);
  readonly selectedId = this.store.selectSignal(
    adminCampaignsFeature.selectSelectedId
  );
  readonly selected = this.store.selectSignal(selectAdminCampaignsSelected);
  readonly sessionKey = this.store.selectSignal(
    adminCampaignsFeature.selectSessionKey
  );
  private active = false;
  private disposed = false;
  private request: AbortController | null = null;

  constructor() {
    effect(() => {
      this.admin.sessionGeneration();
      this.admin.identity();
      this.admin.dataRevision();
      untracked(() => {
        if (this.synchronize() && this.active && this.sessionKey())
          void this.load();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.detach();
      this.disposed = true;
    });
  }

  async connect(): Promise<void> {
    if (this.disposed || !this.browser) return;
    this.active = true;
    await this.load();
  }

  /** Leaving the page cancels work without forgetting its applied query or selection. */
  detach(): void {
    this.active = false;
    this.request?.abort();
    this.request = null;
    this.store.dispatch(adminCampaignsActions.detached());
  }

  select(row: AdminCampaignItem): void {
    if (!this.active || this.disposed) return;
    if (this.synchronize()) {
      if (this.sessionKey()) void this.load();
      return;
    }
    if (this.state() === 'ready' && this.data()?.items.includes(row))
      this.store.dispatch(adminCampaignsActions.selected({ id: row.id }));
  }

  async load(query?: AdminCampaignsQuery): Promise<void> {
    if (this.disposed || !this.active || !this.browser) return;
    const previousSessionKey = this.sessionKey();
    this.synchronize();
    const sessionKey = this.sessionKey();
    if (!sessionKey) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const appliedQuery = {
      ...(query && previousSessionKey === sessionKey ? query : this.query())
    };
    this.store.dispatch(
      adminCampaignsActions.loadRequested({ query: appliedQuery })
    );
    const requestGeneration = this.snapshot().requestGeneration;
    try {
      const response = await this.admin.getCampaigns(
        appliedQuery,
        request.signal
      );
      if (!this.current(requestGeneration, sessionKey)) return;
      this.store.dispatch(
        adminCampaignsActions.loadSucceeded({
          requestGeneration,
          sessionKey,
          response
        })
      );
    } catch (error) {
      if (!this.current(requestGeneration, sessionKey)) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      this.store.dispatch(
        adminCampaignsActions.loadFailed({
          requestGeneration,
          sessionKey,
          status:
            status === 401 || status === 403
              ? 'forbidden'
              : status === 503
                ? 'unavailable'
                : 'error'
        })
      );
      if (status === 401) {
        this.store.dispatch(
          adminCampaignsActions.synchronized({
            sessionKey: null,
            revision: this.admin.dataRevision()
          })
        );
        this.admin.clearAdminSession();
        await this.router.navigate(['/admin/login'], {
          queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
        });
      }
    } finally {
      if (this.request === request) this.request = null;
    }
  }

  /** Also runs before accepting results, so effect scheduling cannot leak another session. */
  private synchronize(): boolean {
    if (this.disposed) return false;
    const valid = this.browser && this.admin.hasValidAdminSession();
    const identity = this.admin.identity();
    const sessionKey = valid
      ? `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? ''}`
      : null;
    const revision = this.admin.dataRevision();
    const current = this.snapshot();
    if (
      current.sessionKey === sessionKey &&
      current.dataRevision === revision &&
      (sessionKey !== null || current.status === 'forbidden')
    )
      return false;
    this.request?.abort();
    this.request = null;
    this.store.dispatch(
      adminCampaignsActions.synchronized({ sessionKey, revision })
    );
    return true;
  }

  private current(requestGeneration: number, sessionKey: string): boolean {
    if (this.disposed || !this.active) return false;
    const changed = this.synchronize();
    if (changed && this.sessionKey()) void this.load();
    return (
      !changed &&
      this.snapshot().requestGeneration === requestGeneration &&
      this.sessionKey() === sessionKey
    );
  }
}
