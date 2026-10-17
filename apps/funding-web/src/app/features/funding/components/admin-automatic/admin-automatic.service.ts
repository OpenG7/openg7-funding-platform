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

import {
  AdminAutomaticPreparationService,
  type AdminAutomaticPreparationEntry
} from './admin-automatic-preparation.service.js';
import {
  AdminAutomaticRun,
  automaticAdminUrl,
  automaticPagePlan,
  automaticPaymentPlan,
  type AdminAutomaticPlan,
  type AdminAutomaticSnapshot
} from './admin-automatic-run.js';

const automaticPreparations: Readonly<Record<string, readonly string[]>> = {
  identity_missing: ['sponsor.identity.edit'],
  identity_submission_pending: ['sponsor.identity.edit'],
  invoice_missing: ['invoice-backfill']
};

type Scope =
  | { kind: 'payment'; contributionId: string }
  | { kind: 'page'; pageId: string; url: string };

/** Session-local orchestration. Preparations are explicit, page-owned callbacks. */
@Injectable({ providedIn: 'root' })
export class AdminAutomaticService {
  readonly guidance = inject(AdminGuidanceService);
  readonly preparations = inject(AdminAutomaticPreparationService);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  readonly snapshot = signal<AdminAutomaticSnapshot>({
    phase: 'idle',
    plan: null,
    events: [],
    error: null
  });
  readonly reveal = signal<{ sequence: number; target: string } | null>(null);
  readonly selection = signal('');
  readonly lastPreparation = signal<string | null>(null);
  private readonly domRevision = signal(0);
  readonly active = computed(
    () =>
      !['idle', 'paused', 'blocked', 'error', 'complete'].includes(
        this.snapshot().phase
      )
  );
  readonly busy = computed(() =>
    ['reading', 'explaining', 'navigating', 'preparing'].includes(
      this.snapshot().phase
    )
  );
  readonly choices = computed(() => {
    this.domRevision();
    this.preparations.entries();
    const plan = this.snapshot().plan;
    return plan && !this.busy() ? this.eligible(plan) : [];
  });
  private scope: Scope | null = null;
  private runIdentity = '';
  private operation = 0;
  private expectedNavigation: { url: string; operation: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private checks = 0;
  private revealSequence = 0;
  private previousIdentity: string | undefined;
  private previousPayment: string | null | undefined;
  private revision = 0;
  private readonly run = new AdminAutomaticRun({
    read: () => this.read(),
    current: () => this.current(),
    canLeavePage: () => this.canLeavePage(),
    explain: () => this.explain(),
    navigate: (plan) => this.navigate(plan),
    present: (plan, id) => this.present(plan, id),
    changed: (snapshot) => {
      if (snapshot.phase === 'navigating') this.reveal.set(null);
      if (snapshot.phase === 'waiting') this.lastPreparation.set(null);
      this.snapshot.set(snapshot);
      this.arm();
    }
  });

  constructor() {
    const destroy = inject(DestroyRef);
    effect(() => {
      const identity = this.identity();
      const payment = this.guidance.snapshot().payment?.contributionId ?? null;
      const enabled =
        this.guidance.available() &&
        this.guidance.enabled() &&
        this.guidance.mode() === 'automatic';
      untracked(() => {
        if (
          (this.previousIdentity !== undefined &&
            this.previousIdentity !== identity) ||
          (this.scope?.kind === 'payment' &&
            this.previousPayment !== undefined &&
            this.previousPayment !== payment)
        )
          this.clear();
        else if (!enabled && this.run.active) this.pause();
        this.previousIdentity = identity;
        this.previousPayment = payment;
      });
    });
    effect(() => {
      const revision = this.admin.dataRevision();
      untracked(() => {
        if (revision !== this.revision && this.run.active)
          this.scheduleCheck(0);
        this.revision = revision;
      });
    });
    const navigation = this.router.events.subscribe((event) => {
      if (
        event instanceof NavigationStart &&
        this.run.active &&
        event.url !== this.expectedNavigation?.url
      )
        this.pause();
    });
    destroy.onDestroy(() => {
      navigation.unsubscribe();
      this.clear();
    });
    afterNextRender(() => {
      const view = this.document.defaultView;
      let frame = 0;
      const invalidate = () => {
        if (!view || frame || this.guidance.mode() !== 'automatic') return;
        frame = view.requestAnimationFrame(() => {
          frame = 0;
          this.domRevision.update((value) => value + 1);
        });
      };
      const observer = view && new view.MutationObserver(invalidate);
      observer?.observe(this.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'open',
          'disabled',
          'hidden',
          'aria-disabled',
          'aria-hidden',
          'inert',
          'class',
          'style'
        ]
      });
      const hide = () => {
        if (this.document.visibilityState === 'hidden') this.pause();
      };
      const leave = () => this.pause();
      const edit = (event: Event) => {
        const element = event.target as HTMLElement | null;
        if (
          this.run.active &&
          element?.closest('#admin-main') &&
          element.matches('input, textarea, select, [contenteditable="true"]')
        )
          this.pause();
      };
      this.document.addEventListener('visibilitychange', hide);
      this.document.addEventListener('input', edit, true);
      this.document.addEventListener('change', edit, true);
      this.document.addEventListener('close', invalidate, true);
      this.document.addEventListener('toggle', invalidate, true);
      this.document.defaultView?.addEventListener('pagehide', leave);
      destroy.onDestroy(() => {
        this.document.removeEventListener('visibilitychange', hide);
        this.document.removeEventListener('input', edit, true);
        this.document.removeEventListener('change', edit, true);
        this.document.removeEventListener('close', invalidate, true);
        this.document.removeEventListener('toggle', invalidate, true);
        observer?.disconnect();
        if (frame) view?.cancelAnimationFrame(frame);
        this.document.defaultView?.removeEventListener('pagehide', leave);
      });
    });
  }

  async start(choice: string): Promise<void> {
    if (this.busy()) return;
    ++this.operation;
    const payment = this.guidance.snapshot().payment;
    // An explicit handoff from the portfolio adopts the chosen payment before
    // the session effect runs; later unsolicited replacements still clear it.
    this.previousPayment = payment?.contributionId ?? null;
    const page = choice === 'payment' ? null : automaticPagePlan(choice);
    if (choice === 'payment' && !payment) return;
    this.scope = page
      ? {
          kind: 'page',
          pageId: page.pageId,
          url:
            this.guidance.page()?.id === page.pageId
              ? (automaticAdminUrl(this.router.url) ?? page.adminUrl)
              : page.adminUrl
        }
      : { kind: 'payment', contributionId: payment!.contributionId };
    this.runIdentity = this.identity();
    this.lastPreparation.set(null);
    this.checks = 0;
    await this.run.start();
  }

  pause(): void {
    ++this.operation;
    this.cancelTimer();
    this.run.pause();
  }

  clear(): void {
    ++this.operation;
    this.cancelTimer();
    this.run.clear();
    this.scope = null;
    this.selection.set('');
    this.lastPreparation.set(null);
    this.runIdentity = '';
    this.reveal.set(null);
  }

  async verify(): Promise<void> {
    if (!this.current()) return;
    await this.run.verify();
  }

  async prepare(entry: AdminAutomaticPreparationEntry): Promise<void> {
    if (!this.current() || !this.choices().includes(entry)) return;
    await this.run.prepare(entry.id);
  }

  private identity(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}`;
  }

  private current(): boolean {
    return (
      this.runIdentity === this.identity() &&
      this.guidance.available() &&
      this.guidance.enabled() &&
      this.guidance.mode() === 'automatic' &&
      this.document.visibilityState !== 'hidden' &&
      this.admin.hasValidAdminSession()
    );
  }

  private canLeavePage(): boolean {
    return !this.document.querySelector(
      'dialog[open], [data-og7-automatic-block]'
    );
  }

  private async read(): Promise<AdminAutomaticPlan> {
    const scope = this.scope;
    if (!scope || !this.current()) throw new Error('AUTOMATIC_UNAVAILABLE');
    if (scope.kind === 'page')
      return { ...automaticPagePlan(scope.pageId), adminUrl: scope.url };
    const identity = this.identity();
    try {
      const response = await this.admin.getPaymentJourney(scope.contributionId);
      if (response.status !== 'ok' || !response.journey)
        throw new Error('AUTOMATIC_UNAVAILABLE');
      return automaticPaymentPlan(response.journey, scope.contributionId);
    } catch (error) {
      if (
        (error as { status?: number })?.status === 401 &&
        identity === this.identity()
      ) {
        this.admin.clearAdminSession();
        await this.router.navigate(['/admin/login'], {
          queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
        });
      }
      throw error;
    }
  }

  private explain(): Promise<void> {
    // A short visible explanation precedes navigation and every preparation.
    return new Promise((resolve) => setTimeout(resolve, 900));
  }

  private async navigate(plan: AdminAutomaticPlan): Promise<boolean> {
    const operation = this.operation;
    const url = automaticAdminUrl(plan.adminUrl);
    if (!url || !this.current()) return false;
    if (url === this.router.url) return true;
    this.expectedNavigation = { url, operation };
    try {
      const moved = await this.router.navigateByUrl(url);
      return moved && this.router.url === url;
    } finally {
      if (this.expectedNavigation?.operation === operation)
        this.expectedNavigation = null;
    }
  }

  private async present(
    plan: AdminAutomaticPlan,
    preparationId?: string
  ): Promise<'prepared' | 'manual' | 'unavailable'> {
    const operation = this.operation;
    if (!this.current()) return 'unavailable';
    await this.ready(plan, operation);
    if (!this.current() || operation !== this.operation) return 'unavailable';
    this.reveal.set({
      sequence: ++this.revealSequence,
      target: plan.target ?? ''
    });
    const choices = this.eligible(plan);
    let selected: AdminAutomaticPreparationEntry | undefined;
    if (preparationId) {
      const matches = choices.filter((entry) => entry.id === preparationId);
      if (matches.length !== 1) return 'unavailable';
      selected = matches[0];
    } else if (plan.state !== 'waiting') {
      const prefixes = automaticPreparations[plan.reason] ?? [];
      const matches = choices.filter((entry) =>
        prefixes.some((prefix) => entry.id.startsWith(prefix))
      );
      if (matches.length === 1) selected = matches[0];
    }
    if (!selected) return 'manual';
    if (
      (!preparationId && !this.canLeavePage()) ||
      !this.current() ||
      operation !== this.operation
    )
      return 'unavailable';
    if (!this.preparations.prepare(selected, plan.contributionId))
      return 'unavailable';
    this.lastPreparation.set(this.preparations.label(selected));
    return 'prepared';
  }

  private eligible(
    plan: AdminAutomaticPlan
  ): readonly AdminAutomaticPreparationEntry[] {
    if (plan.state === 'waiting' || plan.state === 'complete') return [];
    if (this.document.querySelector('[data-og7-automatic-block]')) return [];
    const dialogs = Array.from(
      this.document.querySelectorAll<HTMLDialogElement>('dialog[open]')
    );
    const focused = (
      this.document.activeElement as HTMLElement | null
    )?.closest('dialog[open]');
    const top = focused ?? dialogs.at(-1);
    return this.preparations
      .available(plan.contributionId)
      .filter((entry) => !top || top.contains(entry.element));
  }

  private ready(plan: AdminAutomaticPlan, operation: number): Promise<void> {
    const view = this.document.defaultView;
    if (!view) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = () => {
        observer.disconnect();
        clearTimeout(timer);
        // Include deferred children and their registration effects.
        view.requestAnimationFrame(() =>
          view.requestAnimationFrame(() => resolve())
        );
      };
      const found = () => {
        if (!this.current() || operation !== this.operation) return true;
        const main = this.document.getElementById('admin-main');
        const prefixes = automaticPreparations[plan.reason] ?? [];
        const preparedControlReady =
          prefixes.length === 0 ||
          this.preparations
            .available(plan.contributionId)
            .some((entry) =>
              prefixes.some((prefix) => entry.id.startsWith(prefix))
            );
        return (
          main &&
          preparedControlReady &&
          (!plan.target ||
            Array.from(main.querySelectorAll<HTMLElement>('[data-og7]')).some(
              (element) =>
                element.getAttribute('data-og7') === plan.target &&
                element.getClientRects().length > 0
            ))
        );
      };
      const observer = new view.MutationObserver(() => {
        if (found()) finish();
      });
      observer.observe(this.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'hidden', 'inert', 'class', 'style']
      });
      timer = setTimeout(finish, 5000);
      if (found()) finish();
    });
  }

  private arm(): void {
    this.cancelTimer();
    if (
      this.scope?.kind === 'payment' &&
      ['waiting', 'awaiting_confirmation'].includes(this.snapshot().phase)
    ) {
      if (this.checks >= 30) this.run.pause();
      else this.scheduleCheck(10000);
    }
  }

  private scheduleCheck(delay: number): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.current() || !this.run.active) return;
      ++this.checks;
      void this.verify();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
