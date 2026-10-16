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

import { AdminGuidanceService } from '../../services/admin-guidance.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

import { AdminAutomaticPortfolioClient } from './admin-automatic-portfolio.client.js';
import {
  AdminAutomaticPortfolioRun,
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
    error: null
  });
  readonly active = computed(() =>
    ['loading', 'explaining', 'advancing'].includes(this.snapshot().phase)
  );
  readonly busy = computed(() =>
    ['loading', 'advancing'].includes(this.snapshot().phase)
  );
  private identity = '';
  private previousIdentity: string | undefined;
  private readonly run = new AdminAutomaticPortfolioRun({
    read: (runId) => this.client.read(runId),
    start: () => this.client.start(),
    advance: (run) => this.client.advance(run),
    control: (run, action) => this.client.control(run, action),
    report: (runId, after) => this.client.report(runId, after),
    current: () => this.current(),
    canContinue: () => this.canContinue(),
    explain: () => new Promise((resolve) => setTimeout(resolve, 1100)),
    changed: (snapshot) => this.snapshot.set(snapshot)
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
        )
          this.run.clear();
        else if (!enabled && this.run.active) this.run.pause();
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
        if (
          this.run.active &&
          target?.closest('#admin-main') &&
          target.matches('input,textarea,select,[contenteditable="true"]')
        )
          pause();
      };
      this.document.addEventListener('visibilitychange', hide);
      this.document.addEventListener('input', edit, true);
      this.document.addEventListener('change', edit, true);
      this.document.defaultView?.addEventListener('pagehide', pause);
      destroy.onDestroy(() => {
        this.document.removeEventListener('visibilitychange', hide);
        this.document.removeEventListener('input', edit, true);
        this.document.removeEventListener('change', edit, true);
        this.document.defaultView?.removeEventListener('pagehide', pause);
      });
    });
  }

  async load(): Promise<void> {
    this.identity = this.identityKey();
    await this.run.load();
  }

  async start(): Promise<void> {
    this.preparation.pause();
    this.identity = this.identityKey();
    await this.run.start();
  }

  async resume(recheck = false): Promise<void> {
    this.preparation.pause();
    this.identity = this.identityKey();
    await this.run.resume(recheck);
  }

  pause(): void {
    this.run.pause();
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
