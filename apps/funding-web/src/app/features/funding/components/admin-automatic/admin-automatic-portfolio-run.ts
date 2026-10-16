import type {
  AdminAutomaticRun,
  AdminAutomaticRunEntry,
  AdminAutomaticRunReport,
  AdminAutomaticRunState
} from '@openg7/funding-core';

export type AutomaticPortfolioPhase =
  | 'idle'
  | 'loading'
  | 'review'
  | 'explaining'
  | 'advancing'
  | 'paused'
  | 'completed'
  | 'uncertain'
  | 'error';

export interface AutomaticPortfolioSnapshot {
  readonly phase: AutomaticPortfolioPhase;
  readonly state: AdminAutomaticRunState | null;
  readonly entries: readonly AdminAutomaticRunEntry[];
  readonly nextCursor: number | null;
  readonly error:
    | 'unavailable'
    | 'forbidden'
    | 'stale'
    | 'uncertain'
    | 'invalid_payment_facts'
    | null;
}

export interface AutomaticPortfolioPorts {
  read(runId?: string): Promise<AdminAutomaticRunState>;
  start(): Promise<AdminAutomaticRunState>;
  advance(run: AdminAutomaticRun): Promise<AdminAutomaticRunState>;
  control(
    run: AdminAutomaticRun,
    action: 'pause' | 'resume' | 'recheck' | 'reconcile'
  ): Promise<AdminAutomaticRunState>;
  report(runId: string, after?: number): Promise<AdminAutomaticRunReport>;
  current(): boolean;
  canContinue(): boolean;
  explain(): Promise<void>;
  changed(snapshot: AutomaticPortfolioSnapshot): void;
}

const empty = (): AutomaticPortfolioSnapshot => ({
  phase: 'idle',
  state: null,
  entries: [],
  nextCursor: null,
  error: null
});

/** Each voluntary passage advances one server-owned dossier at a time. */
export class AdminAutomaticPortfolioRun {
  private snapshot = empty();
  private epoch = 0;
  private busy = false;
  private continuing = false;

  constructor(private readonly ports: AutomaticPortfolioPorts) {}

  get active(): boolean {
    return this.continuing;
  }

  async load(): Promise<void> {
    if (this.busy || this.continuing) return;
    await this.perform(async (epoch) => {
      this.update({ phase: 'loading', error: null });
      const state = await this.ports.read();
      if (!this.current(epoch)) return;
      this.update({ state, phase: this.restingPhase(state) });
      await this.readReport(epoch);
      // Reading a durable run never resumes it, including status=running.
    });
  }

  async start(): Promise<void> {
    if (this.busy || this.continuing || !this.ports.canContinue()) return;
    this.continuing = true;
    await this.perform(async (epoch) => {
      this.update({
        phase: 'loading',
        error: null
      });
      const state = await this.ports.start();
      if (!this.current(epoch)) return;
      this.update({ state, entries: [], nextCursor: null });
      await this.drive(epoch);
    }, true);
  }

  async resume(recheck = false): Promise<void> {
    const run = this.snapshot.state?.run;
    if (
      !run ||
      this.busy ||
      this.continuing ||
      run.status === 'uncertain' ||
      this.snapshot.error === 'uncertain' ||
      !this.ports.canContinue()
    )
      return;
    this.continuing = true;
    await this.perform(async (epoch) => {
      this.update({ phase: 'loading', error: null });
      // A stopped browser may have left a running server run. Resume only after
      // the explicit human gesture, never after a GET or a component mount.
      const state =
        recheck || run.status !== 'running'
          ? await this.ports.control(run, recheck ? 'recheck' : 'resume')
          : await this.ports.read(run.id);
      if (!this.current(epoch)) return;
      this.update({ state });
      await this.drive(epoch);
    }, true);
  }

  pause(): void {
    if (!this.continuing) return;
    this.continuing = false;
    if (this.snapshot.phase !== 'idle') this.update({ phase: 'paused' });
    // An in-flight mutation is allowed to finish, then its returned version is
    // used for pause. No guessed version or duplicate advance is submitted.
  }

  async reconcile(): Promise<void> {
    const run = this.snapshot.state?.run;
    if (!run || run.status !== 'uncertain' || this.busy || this.continuing)
      return;
    await this.perform(async (epoch) => {
      this.update({ phase: 'loading', error: null });
      const state = await this.ports.control(run, 'reconcile');
      if (!this.current(epoch)) return;
      this.update({ state, phase: this.restingPhase(state) });
      await this.readReport(epoch);
      // Reconciliation only checks the durable result. Resuming is a separate gesture.
    }, true);
  }

  clear(): void {
    ++this.epoch;
    this.continuing = false;
    this.busy = false;
    this.snapshot = empty();
    this.ports.changed(this.snapshot);
  }

  async more(): Promise<void> {
    const cursor = this.snapshot.nextCursor;
    if (cursor === null || this.busy || this.continuing) return;
    await this.perform(async (epoch) => this.readReport(epoch, cursor));
  }

  private async drive(epoch: number): Promise<void> {
    await this.readReport(epoch);
    while (this.current(epoch) && this.continuing) {
      const run = this.snapshot.state?.run;
      if (!run || run.status !== 'running') break;
      if (!this.ports.canContinue()) {
        this.pause();
        break;
      }
      this.update({ phase: 'explaining' });
      await this.ports.explain();
      if (!this.current(epoch) || !this.continuing) break;
      if (!this.ports.canContinue()) {
        this.pause();
        break;
      }
      this.update({ phase: 'advancing' });
      const state = await this.ports.advance(run);
      if (!this.current(epoch)) return;
      this.update({ state });
      await this.readReport(epoch);
    }
    if (!this.current(epoch)) return;
    const run = this.snapshot.state?.run;
    if (!this.continuing && run?.status === 'running') {
      const state = await this.ports.control(run, 'pause');
      if (!this.current(epoch)) return;
      this.update({ state });
    }
    if (!this.current(epoch)) return;
    this.continuing = false;
    this.update({ phase: this.restingPhase(this.snapshot.state) });
  }

  private async readReport(epoch: number, after?: number): Promise<void> {
    const runId = this.snapshot.state?.run?.id;
    if (!runId) return;
    const report = await this.ports.report(runId, after);
    if (!this.current(epoch) || this.snapshot.state?.run?.id !== runId) return;
    this.update({
      entries: after
        ? [...this.snapshot.entries, ...report.entries]
        : report.entries,
      nextCursor: report.nextCursor
    });
  }

  private async perform(
    operation: (epoch: number) => Promise<void>,
    mutation = false
  ): Promise<void> {
    const epoch = this.epoch;
    this.busy = true;
    try {
      await operation(epoch);
    } catch (error) {
      if (!this.current(epoch)) return;
      this.continuing = false;
      const status = (error as { status?: number } | null)?.status;
      const response = error as {
        code?: unknown;
        error?: { code?: unknown };
      } | null;
      const rejection = response?.code ?? response?.error?.code;
      const code =
        status === 403
          ? 'forbidden'
          : status === 409
            ? 'stale'
            : status === 503 && rejection === 'RUN_INVALID_PAYMENT_FACTS'
              ? 'invalid_payment_facts'
              : mutation && (!status || status >= 500)
                ? 'uncertain'
                : 'unavailable';
      this.update({
        phase: code === 'uncertain' ? 'uncertain' : 'error',
        error: code,
        ...(status === 401 || status === 403
          ? { state: null, entries: [], nextCursor: null }
          : {})
      });
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }

  private current(epoch: number): boolean {
    return epoch === this.epoch && this.ports.current();
  }

  private restingPhase(
    state: AdminAutomaticRunState | null
  ): AutomaticPortfolioPhase {
    const status = state?.run?.status;
    return status === 'completed'
      ? 'completed'
      : status === 'uncertain'
        ? 'uncertain'
        : status === 'paused'
          ? 'paused'
          : 'review';
  }

  private update(value: Partial<AutomaticPortfolioSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...value };
    this.ports.changed(this.snapshot);
  }
}
