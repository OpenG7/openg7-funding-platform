import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  PreflightRehearsalResponse,
  PreflightRehearsalRun,
  PreflightRehearsalScenario,
  PreflightRehearsalStep,
  PreflightRehearsalStepKey
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { PreflightRehearsalRequestError } from '../../services/funding-admin-preflight-rehearsal.client.js';

const stepKeys: readonly PreflightRehearsalStepKey[] = [
  'created',
  'submitted',
  'processing',
  'prepared',
  'returned',
  'review'
];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pollingLimit = 60;
const pollingIntervalMs = 2000;

/** Local recipe observation. Every indicator comes from a persisted server fact. */
@Component({
  selector: 'openg7-admin-preflight-rehearsal',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-preflight-rehearsal.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-preflight-rehearsal.component.css'
  ]
})
export class AdminPreflightRehearsalComponent implements OnInit {
  readonly mode = input<'rehearsal' | 'evidence'>('rehearsal');
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly i18n = inject(FundingI18nService);
  readonly proposalReturned = output<void>();
  readonly data = signal<PreflightRehearsalResponse | null>(null);
  readonly state = signal<
    'loading' | 'ready' | 'disabled' | 'unavailable' | 'forbidden'
  >('loading');
  readonly busy = signal(false);
  readonly following = signal(false);
  readonly paused = signal(false);
  readonly scenario = signal<PreflightRehearsalScenario>('standard');
  readonly error = signal('');
  readonly run = computed(() => this.data()?.run ?? null);
  readonly steps = computed<readonly PreflightRehearsalStep[]>(
    () =>
      this.run()?.steps ??
      stepKeys.map((key) => ({ key, state: 'pending', at: null }))
  );
  readonly canLaunch = computed(
    () =>
      this.data()?.enabled === true &&
      this.data()?.canLaunch === true &&
      this.mode() === 'rehearsal' &&
      this.state() !== 'forbidden'
  );
  readonly canResume = computed(
    () =>
      this.canLaunch() &&
      (Boolean(this.pendingStart()) ||
        this.run()?.delivery === 'uncertain' ||
        this.run()?.delivery === 'prepared' ||
        this.run()?.error?.retryable === true)
  );
  readonly pendingStart = signal<{
    requestId: string;
    scenario: PreflightRehearsalScenario;
  } | null>(null);
  readonly durationSeconds = computed(() => {
    const run = this.run();
    return run
      ? Math.max(
          0,
          Math.round(
            (Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000
          )
        )
      : 0;
  });
  private requestSerial = 0;
  private activeRequest?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private selectedId = '';
  private initialized = false;
  private sessionGeneration = this.admin.sessionGeneration();
  private pollCount = 0;
  private returnedRunId = '';

  constructor() {
    effect(() => {
      const generation = this.admin.sessionGeneration();
      untracked(() => {
        if (generation === this.sessionGeneration) return;
        this.sessionGeneration = generation;
        this.invalidate();
        this.data.set(null);
        this.pendingStart.set(null);
        this.error.set('');
        if (!this.admin.hasValidAdminSession()) this.signIn();
        else void this.observe(true);
      });
    });
    this.destroyRef.onDestroy(() => {
      this.disposed = true;
      this.invalidate();
    });
  }

  ngOnInit(): void {
    if (!this.browser) return;
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('rehearsalId') ?? '';
        if (this.initialized && id === this.selectedId) return;
        this.initialized = true;
        this.selectedId = id;
        this.invalidate();
        this.data.set(null);
        this.pendingStart.set(null);
        this.paused.set(false);
        if (id && !uuid.test(id)) {
          this.state.set('unavailable');
          this.error.set('invalidSelection');
          return;
        }
        void this.observe(true);
      });
  }

  setScenario(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'standard' || value === 'missing_input')
      this.scenario.set(value);
  }

  async start(): Promise<void> {
    if (!this.browser || !this.canLaunch() || this.busy()) return;
    this.invalidate();
    const command = {
      requestId: crypto.randomUUID(),
      scenario: this.scenario()
    };
    this.pendingStart.set(command);
    this.selectedId = command.requestId;
    this.data.update((value) => (value ? { ...value, run: null } : value));
    this.busy.set(true);
    this.error.set('');
    this.paused.set(false);
    const serial = this.requestSerial;
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { rehearsalId: command.requestId },
      queryParamsHandling: 'merge'
    });
    if (this.disposed || serial !== this.requestSerial) return;
    await this.perform(
      (signal) =>
        this.admin.preflightRehearsal.start(
          command.requestId,
          command.scenario,
          signal
        ),
      true
    );
  }

  async resume(): Promise<void> {
    if (!this.canResume() || this.busy()) return;
    const command = this.pendingStart();
    const run = this.run();
    if (command) {
      await this.perform(
        (signal) =>
          this.admin.preflightRehearsal.start(
            command.requestId,
            command.scenario,
            signal
          ),
        true
      );
    } else if (run) {
      await this.perform(
        (signal) => this.admin.preflightRehearsal.resume(run.id, signal),
        true
      );
    }
  }

  async refresh(): Promise<void> {
    if (this.busy() || this.state() === 'forbidden') return;
    if (this.selectedId && !uuid.test(this.selectedId)) return;
    await this.observe(true);
  }

  async selectRun(event: Event): Promise<void> {
    const id = (event.target as HTMLSelectElement).value;
    if (this.busy() || !uuid.test(id)) return;
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { rehearsalId: id },
      queryParamsHandling: 'merge'
    });
  }

  stepTitle(key: PreflightRehearsalStepKey): string {
    return 'admin.preflight.rehearsal.steps.' + key;
  }

  stepStatus(state: string): string {
    return 'admin.preflight.rehearsal.states.' + state;
  }

  missionStatus(value: string | null): string {
    return (
      'admin.preflight.rehearsal.missionStates.' +
      ([
        'received',
        'ready',
        'running',
        'review_ready',
        'waiting_input',
        'failed',
        'cancelled',
        'superseded',
        'completed'
      ].includes(value ?? '')
        ? value
        : 'unknown')
    );
  }

  formatDate(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.valueOf())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'medium'
        }).format(date)
      : '—';
  }

  private async observe(resetPolling: boolean): Promise<void> {
    if (resetPolling) {
      this.pollCount = 0;
      this.paused.set(false);
    }
    await this.perform(
      (signal) =>
        this.admin.preflightRehearsal.read(
          this.selectedId || undefined,
          signal
        ),
      false
    );
  }

  private async perform(
    action: (signal: AbortSignal) => Promise<PreflightRehearsalResponse>,
    command: boolean
  ): Promise<void> {
    if (!this.browser || this.disposed) return;
    this.invalidate();
    if (command) {
      this.pollCount = 0;
      this.paused.set(false);
    }
    const serial = this.requestSerial;
    const session = this.admin.sessionGeneration();
    const controller = new AbortController();
    this.activeRequest = controller;
    this.busy.set(true);
    this.error.set('');
    if (!this.data()) this.state.set('loading');
    try {
      const response = await action(controller.signal);
      if (!this.current(serial, session, controller)) return;
      this.data.set(response);
      this.state.set(response.enabled ? 'ready' : 'disabled');
      if (response.run) {
        this.pendingStart.set(null);
        if (response.run.id !== this.selectedId) {
          this.selectedId = response.run.id;
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { rehearsalId: response.run.id },
            queryParamsHandling: 'merge',
            replaceUrl: true
          });
        }
        if (response.run.receivedAt && response.run.id !== this.returnedRunId) {
          this.returnedRunId = response.run.id;
          this.proposalReturned.emit();
        }
      }
      this.follow(response.run);
    } catch (error) {
      if (!this.current(serial, session, controller)) return;
      if (
        error instanceof PreflightRehearsalRequestError &&
        error.status === 401
      ) {
        this.signIn();
        return;
      }
      const status =
        error instanceof PreflightRehearsalRequestError ? error.status : 0;
      if (status === 403) {
        this.data.set(null);
        this.pendingStart.set(null);
      }
      this.state.set(status === 403 ? 'forbidden' : 'unavailable');
      this.error.set(
        status === 403
          ? 'forbidden'
          : status === 404
            ? 'notFound'
            : status === 409
              ? 'conflict'
              : command
                ? 'commandUnavailable'
                : 'observationUnavailable'
      );
      this.paused.set(false);
    } finally {
      if (this.current(serial, session, controller)) this.busy.set(false);
    }
  }

  private follow(run: PreflightRehearsalRun | null): void {
    if (
      !run ||
      run.terminal ||
      run.error ||
      run.delivery !== 'acknowledged' ||
      [
        'review_ready',
        'waiting_input',
        'failed',
        'cancelled',
        'superseded',
        'completed'
      ].includes(run.missionStatus ?? '')
    )
      return;
    if (this.pollCount >= pollingLimit) {
      this.paused.set(true);
      return;
    }
    this.following.set(true);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pollCount++;
      void this.observe(false);
    }, pollingIntervalMs);
  }

  private current(
    serial: number,
    session: number,
    controller: AbortController
  ): boolean {
    return (
      !this.disposed &&
      serial === this.requestSerial &&
      session === this.admin.sessionGeneration() &&
      !controller.signal.aborted
    );
  }

  private invalidate(): void {
    this.requestSerial++;
    this.activeRequest?.abort();
    this.activeRequest = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.following.set(false);
    this.busy.set(false);
  }

  private signIn(): void {
    this.invalidate();
    this.data.set(null);
    this.pendingStart.set(null);
    void this.router.navigate(['/admin/login'], {
      queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
    });
  }
}
