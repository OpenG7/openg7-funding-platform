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
  | 'awaiting_approval'
  | 'advancing'
  | 'paused'
  | 'completed'
  | 'uncertain'
  | 'error';

export type AutomaticPortfolioReviewStep =
  'scope' | 'dossier' | 'result' | 'summary';

export interface AutomaticPortfolioReview {
  readonly id: number;
  readonly step: AutomaticPortfolioReviewStep;
}

export interface AutomaticPortfolioSnapshot {
  readonly phase: AutomaticPortfolioPhase;
  readonly state: AdminAutomaticRunState | null;
  readonly entries: readonly AdminAutomaticRunEntry[];
  readonly nextCursor: number | null;
  readonly review: AutomaticPortfolioReview | null;
  readonly reportLoading?: boolean;
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
  explain(
    step: AutomaticPortfolioReviewStep,
    state: AdminAutomaticRunState
  ): Promise<void>;
  changed(snapshot: AutomaticPortfolioSnapshot): void;
}

const empty = (): AutomaticPortfolioSnapshot => ({
  phase: 'idle',
  state: null,
  entries: [],
  nextCursor: null,
  review: null,
  reportLoading: false,
  error: null
});

/** Each voluntary passage advances one server-owned dossier at a time. */
export class AdminAutomaticPortfolioRun {
  private snapshot = empty();
  private epoch = 0;
  private busy = false;
  private continuing = false;
  // A completed server run may still have final readings paused in this visit.
  private pausedReading: Pick<AdminAutomaticRun, 'id' | 'pass'> | null = null;
  private reviewSequence = 0;
  private reportSequence = 0;
  private pendingReview: {
    readonly id: number;
    readonly epoch: number;
    readonly resolve: (approved: boolean) => void;
  } | null = null;

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
      const readingPaused =
        state.run?.status === 'completed' &&
        this.pausedReading?.id === state.run.id &&
        this.pausedReading.pass === state.run.pass;
      this.update({
        state,
        phase: readingPaused ? 'paused' : this.restingPhase(state)
      });
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
        recheck || run.status === 'paused'
          ? await this.ports.control(run, recheck ? 'recheck' : 'resume')
          : await this.ports.read(run.id);
      if (!this.current(epoch)) return;
      this.update({ state });
      await this.drive(epoch, true);
    }, true);
  }

  pause(): void {
    if (!this.continuing) return;
    this.continuing = false;
    this.cancelReview();
    ++this.reportSequence;
    if (this.snapshot.phase !== 'idle')
      this.update({ phase: 'paused', review: null, reportLoading: false });
    // An in-flight mutation is allowed to finish, then its returned version is
    // used for pause. No guessed version or duplicate advance is submitted.
  }

  approve(id: number): void {
    const pending = this.pendingReview;
    if (
      !pending ||
      this.snapshot.review?.id !== id ||
      pending.id !== id ||
      this.snapshot.reportLoading ||
      this.snapshot.error ||
      !this.current(pending.epoch) ||
      !this.continuing
    )
      return;
    if (!this.ports.canContinue()) {
      this.pause();
      return;
    }
    // Consume synchronously: a repeated activation cannot approve the next zone.
    this.pendingReview = null;
    this.update({ review: null });
    pending.resolve(true);
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
    this.cancelReview();
    ++this.reportSequence;
    this.pausedReading = null;
    this.snapshot = empty();
    this.ports.changed(this.snapshot);
  }

  async more(): Promise<void> {
    const cursor = this.snapshot.nextCursor;
    if (cursor === null || this.snapshot.reportLoading) return;
    const review = this.snapshot.review;
    if (
      this.snapshot.phase === 'awaiting_approval' &&
      review?.step === 'summary' &&
      this.continuing &&
      this.current(this.epoch)
    ) {
      await this.moreDuringSummary(cursor, review.id);
      return;
    }
    if (this.busy || this.continuing) return;
    await this.perform(async (epoch) => this.readReport(epoch, cursor));
  }

  private async moreDuringSummary(
    cursor: number,
    reviewId: number
  ): Promise<void> {
    const epoch = this.epoch;
    const runId = this.snapshot.state?.run?.id;
    if (!runId) return;
    const request = ++this.reportSequence;
    const current = () =>
      request === this.reportSequence &&
      this.current(epoch) &&
      this.continuing &&
      this.snapshot.phase === 'awaiting_approval' &&
      this.snapshot.review?.id === reviewId &&
      this.snapshot.state?.run?.id === runId;
    this.update({ reportLoading: true });
    try {
      const report = await this.ports.report(runId, cursor);
      if (!current()) return;
      this.update({
        entries: [...this.snapshot.entries, ...report.entries],
        nextCursor: report.nextCursor,
        error: null,
        reportLoading: false
      });
    } catch (error) {
      if (!current()) return;
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403) {
        this.continuing = false;
        this.cancelReview();
        ++this.reportSequence;
        this.update({
          phase: 'error',
          error: status === 403 ? 'forbidden' : 'unavailable',
          state: null,
          entries: [],
          nextCursor: null,
          review: null,
          reportLoading: false
        });
      } else {
        // A failed report GET neither casts doubt on nor repeats server work.
        // Keep this reading open so its page can be retried explicitly.
        this.update({ error: 'unavailable', reportLoading: false });
      }
    }
  }

  private async drive(epoch: number, resuming = false): Promise<void> {
    await this.readReport(epoch);
    if (!this.current(epoch)) return;
    const initialRun = this.snapshot.state?.run;
    if (initialRun && initialRun.status !== 'uncertain') {
      if (await this.checkpoint('scope', epoch)) {
        // A stopped visit may not have acknowledged the latest durable result.
        // Reading it again never repeats its server operation.
        if (resuming && initialRun.latestEntry?.pass === initialRun.pass)
          await this.checkpoint('result', epoch);
      }
    }
    while (this.current(epoch) && this.continuing) {
      const run = this.snapshot.state?.run;
      if (!run || run.status !== 'running') break;
      if (!(await this.checkpoint('dossier', epoch)) || !this.canProceed(epoch))
        break;
      this.update({ phase: 'advancing' });
      const state = await this.ports.advance(run);
      if (!this.current(epoch)) return;
      this.update({ state });
      await this.readReport(epoch);
      if (!this.current(epoch)) return;
      if (state.run?.status === 'uncertain') break;
      if (!(await this.checkpoint('result', epoch))) break;
    }
    if (!this.current(epoch)) return;
    if (this.continuing && this.snapshot.state?.run?.status === 'completed')
      await this.checkpoint('summary', epoch);
    if (!this.current(epoch)) return;
    if (this.snapshot.phase === 'error' || this.snapshot.phase === 'uncertain')
      return;
    const paused = !this.continuing;
    const run = this.snapshot.state?.run;
    if (paused && run?.status === 'running') {
      const state = await this.ports.control(run, 'pause');
      if (!this.current(epoch)) return;
      this.update({ state });
    }
    if (!this.current(epoch)) return;
    this.continuing = false;
    this.update({
      phase: paused ? 'paused' : this.restingPhase(this.snapshot.state),
      review: null
    });
  }

  private async checkpoint(
    step: AutomaticPortfolioReviewStep,
    epoch: number
  ): Promise<boolean> {
    if (!this.canProceed(epoch)) return false;
    const state = this.snapshot.state;
    if (!state?.run || state.run.status === 'uncertain') return false;
    const id = ++this.reviewSequence;
    let resolve!: (approved: boolean) => void;
    const approval = new Promise<boolean>((done) => (resolve = done));
    const pending = { id, epoch, resolve };
    this.pendingReview = pending;
    this.update({ phase: 'explaining', review: null });
    // Cancelling a reading also releases a pending read-only preparation. Its
    // eventual response cannot restore this checkpoint or approve another one.
    const prepared = await Promise.race([
      Promise.resolve()
        .then(() => this.ports.explain(step, state))
        .then(() => true),
      approval.then(() => false)
    ]);
    if (
      !prepared ||
      this.pendingReview !== pending ||
      !this.canProceed(epoch)
    ) {
      if (this.pendingReview === pending) this.cancelReview();
      return false;
    }
    this.update({ phase: 'awaiting_approval', review: { id, step } });
    const approved = await approval;
    return approved && this.canProceed(epoch);
  }

  private canProceed(epoch: number): boolean {
    if (!this.current(epoch) || !this.continuing) return false;
    if (!this.ports.canContinue()) {
      this.pause();
      return false;
    }
    return true;
  }

  private cancelReview(): void {
    const pending = this.pendingReview;
    this.pendingReview = null;
    pending?.resolve(false);
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
      this.cancelReview();
      ++this.reportSequence;
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
              : rejection === 'RUN_READING_UNAVAILABLE'
                ? 'unavailable'
                : mutation && (!status || status >= 500)
                  ? 'uncertain'
                  : 'unavailable';
      this.update({
        phase: code === 'uncertain' ? 'uncertain' : 'error',
        error: code,
        review: null,
        reportLoading: false,
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
    const run = this.snapshot.state?.run;
    if (value.phase === 'paused' && run?.status === 'completed')
      this.pausedReading = { id: run.id, pass: run.pass };
    else if (
      !run ||
      run.status !== 'completed' ||
      run.id !== this.pausedReading?.id ||
      run.pass !== this.pausedReading.pass ||
      value.phase === 'completed'
    )
      this.pausedReading = null;
    this.ports.changed(this.snapshot);
  }
}
