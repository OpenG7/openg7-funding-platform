import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, UrlTree } from '@angular/router';
import { filter, map } from 'rxjs';
import type { AdminPaymentJourney } from '@openg7/funding-core';

import { AdminGuidanceService } from '../../services/admin-guidance.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import { guidanceContributionId } from '../../services/admin-guidance-state.js';

export type PaymentJourneyState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'forbidden'
  | 'not_found'
  | 'unavailable';

function localAdminDestination(url: string): string | null {
  return /^\/admin\/fundraiser(?:[/?#]|$)/.test(url) &&
    !url.includes('\\') &&
    !url.split(/[?#]/, 1)[0].includes('..')
    ? url
    : null;
}

/** Revalidates a saved identifier against private server facts; never executes a business action. */
@Injectable({ providedIn: 'root' })
export class AdminPaymentJourneyService {
  readonly guidance = inject(AdminGuidanceService);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly activeId = signal<string | null>(null);
  private readonly navigationUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );
  readonly data = signal<AdminPaymentJourney | null>(null);
  readonly state = signal<PaymentJourneyState>('idle');
  readonly changed = signal(false);
  readonly nextUrl = computed(() => {
    const next = this.state() === 'ready' ? this.data()?.next : null;
    return next ? localAdminDestination(next.adminUrl) : null;
  });
  readonly canShow = computed(() => {
    const nextUrl = this.nextUrl();
    if (!nextUrl) return false;
    const destination = this.router.parseUrl(nextUrl);
    const current = this.router.parseUrl(this.navigationUrl());
    return (
      new UrlTree(destination.root).toString() ===
        new UrlTree(current.root).toString() &&
      Object.entries(destination.queryParams).every(
        ([key, value]) =>
          JSON.stringify(current.queryParams[key]) === JSON.stringify(value)
      )
    );
  });
  readonly contributionId = this.activeId.asReadonly();
  readonly paused = computed(() => {
    const payment = this.guidance.snapshot().payment;
    return payment?.contributionId === this.contributionId() && payment.paused;
  });
  private request = 0;
  private previous: { contributionId: string; signature: string } | null = null;

  constructor() {
    effect(() => {
      const id = this.contributionId();
      if (id && this.guidance.available())
        untracked(() => this.guidance.followPayment(id, true));
    });
    effect((onCleanup) => {
      const id = this.contributionId();
      const active = this.activePage() && !this.paused();
      this.admin.sessionGeneration();
      this.admin.identity();
      this.admin.dataRevision();
      onCleanup(() => {
        ++this.request;
      });
      untracked(() => {
        this.data.set(null);
        this.state.set('idle');
        if (!active || !id) {
          this.previous = null;
          this.changed.set(false);
          return;
        }
        void this.refresh();
      });
    });
  }

  /** Only the owning Contributions page activates reads; the Guide stores no facts. */
  connect(contributionId: string | null): void {
    const id = guidanceContributionId(contributionId);
    if (id === this.activeId()) return;
    this.disconnect();
    this.activeId.set(id);
  }

  disconnect(): void {
    ++this.request;
    this.activeId.set(null);
    this.data.set(null);
    this.state.set('idle');
    this.changed.set(false);
    this.previous = null;
  }

  pause(): void {
    const id = this.contributionId();
    if (!id || !this.guidance.available()) return;
    this.guidance.followPayment(id, true);
    this.guidance.pausePayment();
  }

  resume(): void {
    const id = this.contributionId();
    if (!id || !this.guidance.available()) return;
    this.guidance.followPayment(id, true);
    this.guidance.resumePayment();
  }

  private activePage(): boolean {
    // NavigationEnd triggers rereads; router.url also rejects an obsolete response
    // during the synchronous route-parameter update before that event is emitted.
    this.navigationUrl();
    const current = this.router.parseUrl(this.router.url);
    const ids = current.queryParamMap.getAll('contributionId');
    return (
      this.admin.hasValidAdminSession() &&
      this.guidance.available() &&
      new UrlTree(current.root).toString() ===
        '/admin/fundraiser/contributions' &&
      (ids.length === 0 ||
        (ids.length === 1 &&
          guidanceContributionId(ids[0]) === this.contributionId()))
    );
  }

  async refresh(): Promise<AdminPaymentJourney | null> {
    const id = this.contributionId();
    if (!id || this.paused() || !this.activePage()) return null;
    const request = ++this.request;
    const generation = this.admin.sessionGeneration();
    const identity = this.admin.identity();
    const current = () =>
      request === this.request &&
      generation === this.admin.sessionGeneration() &&
      identity === this.admin.identity() &&
      this.activePage() &&
      this.contributionId() === id &&
      !this.paused();
    this.state.set('loading');
    this.data.set(null);
    this.changed.set(false);
    try {
      const response = await this.admin.getPaymentJourney(id);
      if (!current()) return null;
      if (
        response.status !== 'ok' ||
        !response.journey ||
        response.journey.contributionId !== id
      ) {
        this.state.set(
          response.status === 'not_found' ? 'not_found' : 'unavailable'
        );
        return null;
      }
      const signature = JSON.stringify(response.journey);
      this.changed.set(
        this.previous?.contributionId === id &&
          this.previous.signature !== signature
      );
      this.previous = { contributionId: id, signature };
      this.data.set(response.journey);
      this.state.set('ready');
      return response.journey;
    } catch (error) {
      const status =
        error instanceof AdminDashboardRequestError ? error.status : undefined;
      if (!current()) {
        // Leaving Contributions can make its read obsolete, but its current session's
        // rejection must still clear private drafts held by other admin panels.
        // Restoring the same cookie session creates a fresh identity object.
        const currentIdentity = this.admin.identity();
        if (
          status === 401 &&
          generation === this.admin.sessionGeneration() &&
          identity?.id === currentIdentity?.id &&
          identity?.sessionId === currentIdentity?.sessionId
        )
          this.admin.clearAdminSession();
        return null;
      }
      this.previous = null;
      this.state.set(status === 403 ? 'forbidden' : 'error');
      if (status === 401) {
        this.admin.clearAdminSession();
        await this.router.navigate(['/admin/login'], {
          queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
        });
      }
      return null;
    }
  }

  /** Only local admin destinations can be opened, after a fresh server read. */
  async openNext(event: Event): Promise<void> {
    event.preventDefault();
    const before = this.data()?.next;
    if (this.state() !== 'ready' || !before) return;
    const fresh = await this.refresh();
    if (
      !fresh?.next ||
      fresh.next.reason !== before.reason ||
      fresh.next.adminUrl !== before.adminUrl ||
      fresh.next.target !== before.target
    )
      return;
    const url = localAdminDestination(fresh.next.adminUrl);
    if (!url) return;
    await this.router.navigateByUrl(url);
  }
}
