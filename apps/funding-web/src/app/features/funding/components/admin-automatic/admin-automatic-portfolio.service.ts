import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import type {
  AdminPaymentJourney,
  AdminAutomaticRunState
} from '@openg7/funding-core';

import { AdminGuidanceService } from '../../services/admin-guidance.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { adminContentRegions } from '../admin-layout/admin-content-scope.js';

import { AdminAutomaticPortfolioClient } from './admin-automatic-portfolio.client.js';
import {
  AdminAutomaticPortfolioRun,
  type AutomaticPortfolioReviewStep,
  type AutomaticPortfolioSnapshot
} from './admin-automatic-portfolio-run.js';
import { AdminAutomaticService } from './admin-automatic.service.js';

/** Visible browser driver; responsibilities, effects and reports belong to the API. */
@Injectable({ providedIn: 'root' })
export class AdminAutomaticPortfolioService {
  private readonly admin = inject(FundingAdminService);
  private readonly guidance = inject(AdminGuidanceService);
  private readonly preparation = inject(AdminAutomaticService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly client = new AdminAutomaticPortfolioClient(this.admin);
  readonly snapshot = signal<AutomaticPortfolioSnapshot>({
    phase: 'idle',
    state: null,
    entries: [],
    nextCursor: null,
    error: null,
    review: null
  });
  readonly reviewJourney = signal<AdminPaymentJourney | null>(null);
  readonly reviewObservedAt = signal<string | null>(null);
  readonly active = computed(() =>
    ['loading', 'explaining', 'awaiting_approval', 'advancing'].includes(
      this.snapshot().phase
    )
  );
  readonly busy = computed(() =>
    ['loading', 'advancing'].includes(this.snapshot().phase)
  );
  private identity = '';
  private loading: Promise<void> | null = null;
  private previousIdentity: string | undefined;
  private readingOperation = 0;
  private readonly run = new AdminAutomaticPortfolioRun({
    read: (runId) => this.client.read(runId),
    start: () => this.client.start(),
    advance: (run) => this.client.advance(run),
    control: (run, action) => this.client.control(run, action),
    report: (runId, after) => this.client.report(runId, after),
    current: () => this.current(),
    canContinue: () => this.canContinue(),
    explain: (step, state) => this.prepareReading(step, state),
    changed: (snapshot) => {
      if (!['explaining', 'awaiting_approval'].includes(snapshot.phase)) {
        ++this.readingOperation;
        this.reviewJourney.set(null);
        this.reviewObservedAt.set(null);
      }
      this.snapshot.set(snapshot);
    }
  });

  constructor() {
    const destroy = inject(DestroyRef);
    effect(() => {
      const identity = this.identityKey();
      const enabled =
        this.guidance.available() &&
        this.guidance.enabled() &&
        this.guidance.mode() === 'automatic';
      untracked(() => {
        if (
          this.previousIdentity !== undefined &&
          this.previousIdentity !== identity
        ) {
          this.loading = null;
          this.run.clear();
        } else if (!enabled && this.run.active) this.run.pause();
        this.previousIdentity = identity;
      });
    });
    const navigation = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && this.run.active) this.run.pause();
    });
    destroy.onDestroy(() => {
      navigation.unsubscribe();
      this.run.clear();
    });
    afterNextRender(() => {
      const pause = () => this.run.pause();
      const hide = () => {
        if (this.document.visibilityState === 'hidden') pause();
      };
      const edit = (event: Event) => {
        const target = event.target as HTMLElement | null;
        const layout = this.document
          .getElementById('admin-main')
          ?.closest<HTMLElement>('[data-og7="admin-layout"]');
        if (
          this.run.active &&
          target &&
          layout &&
          target.closest('[data-og7="admin-layout"]') === layout &&
          adminContentRegions(layout).some((content) =>
            content.contains(target)
          ) &&
          target.matches('input,textarea,select,[contenteditable="true"]')
        )
          pause();
      };
      this.document.addEventListener('visibilitychange', hide);
      this.document.addEventListener('input', edit, true);
      this.document.addEventListener('change', edit, true);
      this.document.defaultView?.addEventListener('pagehide', pause);
      const observer = new MutationObserver(() => {
        if (
          this.run.active &&
          this.document.querySelector(
            'dialog[open], [data-og7-automatic-block]'
          )
        )
          pause();
      });
      observer.observe(this.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'data-og7-automatic-block']
      });
      destroy.onDestroy(() => {
        observer.disconnect();
        this.document.removeEventListener('visibilitychange', hide);
        this.document.removeEventListener('input', edit, true);
        this.document.removeEventListener('change', edit, true);
        this.document.defaultView?.removeEventListener('pagehide', pause);
      });
    });
  }

  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.identity = this.identityKey();
    const loading = this.run.load().finally(() => {
      if (this.loading === loading) this.loading = null;
    });
    this.loading = loading;
    return loading;
  }

  async start(): Promise<void> {
    this.preparation.pause();
    const identity = this.identityKey();
    this.identity = identity;
    await this.run.start();
    if (identity === this.identityKey()) void this.admin.refreshWorkQueue();
  }

  async resume(recheck = false): Promise<void> {
    this.preparation.pause();
    const identity = this.identityKey();
    this.identity = identity;
    await this.run.resume(recheck);
    if (identity === this.identityKey()) void this.admin.refreshWorkQueue();
  }

  pause(): void {
    this.run.pause();
  }

  approve(readingId: number): void {
    this.run.approve(readingId);
  }

  private async prepareReading(
    step: AutomaticPortfolioReviewStep,
    state: AdminAutomaticRunState
  ): Promise<void> {
    const operation = ++this.readingOperation;
    this.reviewJourney.set(null);
    this.reviewObservedAt.set(null);
    if (step !== 'dossier') return;
    const contributionId = state.run?.nextContributionId;
    try {
      if (!contributionId) throw new Error('Missing reading dossier');
      const response = await this.admin.getPaymentJourney(contributionId);
      if (operation !== this.readingOperation || !this.current()) return;
      if (
        response.status !== 'ok' ||
        response.journey?.contributionId !== contributionId
      )
        throw new Error('Reading dossier unavailable');
      this.reviewJourney.set(response.journey);
      this.reviewObservedAt.set(response.generatedAt);
    } catch (error) {
      if (operation !== this.readingOperation || !this.current()) return;
      throw Object.assign(new Error('AUTOMATIC_READING_UNAVAILABLE'), {
        status: (error as { status?: number } | null)?.status ?? 503,
        code: 'RUN_READING_UNAVAILABLE'
      });
    }
  }

  async more(): Promise<void> {
    await this.run.more();
  }

  async reconcile(): Promise<void> {
    await this.run.reconcile();
  }

  private current(): boolean {
    return (
      this.identity === this.identityKey() &&
      this.guidance.available() &&
      this.admin.hasValidAdminSession()
    );
  }

  private canContinue(): boolean {
    return (
      this.current() &&
      this.guidance.enabled() &&
      this.guidance.mode() === 'automatic' &&
      this.document.visibilityState !== 'hidden' &&
      !this.document.querySelector('dialog[open], [data-og7-automatic-block]')
    );
  }

  private identityKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}`;
  }
}
