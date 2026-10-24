import { DOCUMENT } from '@angular/common';
import {
  Injectable,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

import {
  ADMIN_GUIDANCE_PAGES,
  adminGuidancePage
} from '../components/admin-guidance/admin-guidance-pages.js';
import { ADMIN_WORKFLOW_GUIDE_JOURNEYS } from '../components/admin-guidance/admin-workflow-guide.catalog.js';

import {
  AdminGuidanceState,
  guidanceContributionId,
  guidancePaymentContext,
  type AdminGuidanceSnapshot
} from './admin-guidance-state.js';
import { FundingAdminService } from './funding-admin.service.js';

const empty = (): AdminGuidanceSnapshot => ({ enabled: false, bookmark: null });

/** Personal cues and an optional payment UUID; server facts and commands are never saved. */
@Injectable({ providedIn: 'root' })
export class AdminGuidanceService {
  private readonly document = inject(DOCUMENT);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );
  private readonly ready = signal(false);
  private readonly saved = signal<AdminGuidanceSnapshot>(empty());
  private readonly account = signal<string | null>(null);
  private readonly generation = signal(-1);
  private readonly store = new AdminGuidanceState(
    () => this.document.defaultView?.localStorage ?? null
  );
  readonly available = computed(
    () =>
      this.account() !== null &&
      this.generation() === this.admin.sessionGeneration() &&
      this.account() === (this.admin.identity()?.id ?? 'token')
  );
  readonly tokenShared = computed(() => this.account() === 'token');
  readonly snapshot = computed(() =>
    this.available() ? this.saved() : empty()
  );
  readonly page = computed(() => adminGuidancePage(this.url()));
  readonly enabled = computed(() => this.snapshot().enabled);
  readonly mode = computed(() => this.snapshot().mode ?? 'discovery');
  readonly paymentContext = computed(() => {
    const params = this.router.parseUrl(this.url()).queryParams;
    return guidancePaymentContext(
      this.page()?.id,
      params['contributionId'],
      params['sponsorshipId']
    );
  });
  readonly requestedPayment = computed(() =>
    guidanceContributionId(
      this.router.parseUrl(this.url()).queryParams['paymentJourney']
    )
  );
  readonly navigationUrl = this.url;
  readonly workflow = computed(
    () =>
      this.snapshot().workflow ?? {
        journeyId: 'agreement',
        step: 0,
        paused: false
      }
  );
  readonly storageAvailable = signal(true);
  readonly forgetFailed = signal(false);
  readonly resumeTarget = signal<string | null>(null);
  readonly bookmarkPage = computed(() =>
    ADMIN_GUIDANCE_PAGES.find(
      (page) => page.id === this.snapshot().bookmark?.pageId
    )
  );
  readonly index = computed(() => {
    const bookmark = this.snapshot().bookmark;
    return bookmark && bookmark.pageId === this.page()?.id ? bookmark.step : 0;
  });
  readonly step = computed(() => this.page()?.steps[this.index()]);

  constructor() {
    afterNextRender(() => this.ready.set(true));
    effect(() => {
      const identity = this.admin.identity();
      const generation = this.admin.sessionGeneration();
      if (!this.ready()) return;
      if (
        untracked(
          () =>
            this.generation() === generation &&
            (identity
              ? this.account() === identity.id
              : this.account() === null || this.account() === 'token')
        )
      )
        return;
      const account = untracked(() =>
        this.admin.hasValidAdminSession() ? (identity?.id ?? 'token') : null
      );
      this.account.set(account);
      // Checking an expired session can invalidate it. Retain the settled generation
      // so reading the now-empty session cannot repeatedly invalidate itself.
      this.generation.set(untracked(() => this.admin.sessionGeneration()));
      this.saved.set(account ? this.store.load(account) : empty());
      this.storageAvailable.set(this.store.storageAvailable);
      this.resumeTarget.set(null);
      this.forgetFailed.set(false);
    });
    effect(() => {
      const requested = this.requestedPayment();
      if (!this.ready() || !this.available() || !requested) return;
      untracked(() => {
        this.followPayment(requested, true);
        void this.router.navigate(['/admin/fundraiser/contributions'], {
          queryParams: { contributionId: requested },
          replaceUrl: true
        });
      });
    });
  }

  toggle(): void {
    const current = this.snapshot();
    this.persist({
      ...current,
      enabled: !current.enabled,
      bookmark: current.bookmark ?? this.currentBookmark()
    });
  }
  setMode(mode: 'discovery' | 'automatic' | 'workflows'): void {
    const current = { ...this.snapshot() };
    delete current.mode;
    this.persist({ ...current, ...(mode !== 'discovery' ? { mode } : {}) });
  }
  selectWorkflow(journeyId: string, step = 0): void {
    const journey = ADMIN_WORKFLOW_GUIDE_JOURNEYS.find(
      (entry) => entry.id === journeyId
    );
    if (
      !journey ||
      !Number.isInteger(step) ||
      step < 0 ||
      step >= journey.steps.length
    )
      return;
    this.persist({
      ...this.snapshot(),
      enabled: true,
      mode: 'workflows',
      workflow: { journeyId, step, paused: false }
    });
  }
  pauseWorkflow(paused: boolean): void {
    this.persist({
      ...this.snapshot(),
      workflow: { ...this.workflow(), paused }
    });
  }
  followPayment(contributionId: string, preservePause = false): void {
    const id = guidanceContributionId(contributionId);
    if (!id) return;
    const current = this.snapshot();
    this.persist({
      ...current,
      payment: {
        contributionId: id,
        paused:
          preservePause && current.payment?.contributionId === id
            ? current.payment.paused
            : false
      }
    });
  }
  pausePayment(): void {
    const current = this.snapshot();
    if (current.payment)
      this.persist({
        ...current,
        payment: { ...current.payment, paused: true }
      });
  }
  resumePayment(): void {
    const current = this.snapshot();
    if (current.payment)
      this.persist({
        ...current,
        payment: { ...current.payment, paused: false }
      });
  }
  move(direction: number): void {
    const page = this.page();
    if (!page || this.snapshot().bookmark?.paused) return;
    const step = Math.max(
      0,
      Math.min(page.steps.length - 1, this.index() + direction)
    );
    this.persist({
      ...this.snapshot(),
      enabled: true,
      bookmark: { pageId: page.id, step, paused: false }
    });
  }
  restart(): void {
    const page = this.page();
    if (page)
      this.persist({
        ...this.snapshot(),
        enabled: true,
        bookmark: { pageId: page.id, step: 0, paused: false }
      });
  }
  pause(): void {
    this.persist({
      ...this.snapshot(),
      enabled: true,
      bookmark: this.currentBookmark(true)
    });
  }
  resume(): void {
    const bookmark = this.snapshot().bookmark;
    if (!bookmark) return;
    this.resumeTarget.set(bookmark.pageId);
    this.persist({
      ...this.snapshot(),
      enabled: true,
      bookmark: { ...bookmark, paused: false }
    });
  }
  resumeHere(): void {
    const bookmark = this.currentBookmark();
    if (!bookmark) return;
    this.resumeTarget.set(bookmark.pageId);
    this.persist({ ...this.snapshot(), enabled: true, bookmark });
  }
  forget(): void {
    const account = this.currentAccount();
    if (!account) return;
    const payment = this.snapshot().payment;
    const cleared = {
      ...empty(),
      ...(payment ? { payment: { ...payment } } : {})
    };
    const saved = payment
      ? this.store.save(account, cleared)
      : this.store.clear(account);
    this.forgetFailed.set(!saved);
    this.saved.set(cleared);
    this.storageAvailable.set(this.store.storageAvailable);
    this.resumeTarget.set(null);
  }
  private currentBookmark(paused = false) {
    const page = this.page();
    return page ? { pageId: page.id, step: this.index(), paused } : null;
  }
  private currentAccount(): string | null {
    if (!this.ready() || !this.admin.hasValidAdminSession()) return null;
    const current = this.admin.identity()?.id ?? 'token';
    return current === this.account() ? current : null;
  }
  private persist(snapshot: AdminGuidanceSnapshot): void {
    const account = this.currentAccount();
    if (!account) return;
    this.store.save(account, snapshot);
    this.forgetFailed.set(false);
    this.saved.set(this.store.load(account));
    this.storageAvailable.set(this.store.storageAvailable);
  }
}
