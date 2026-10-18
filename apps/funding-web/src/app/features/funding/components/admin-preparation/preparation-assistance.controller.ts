import { signal } from '@angular/core';
import type {
  PreparationAssistanceDraft,
  PreparationAssistanceResolution,
  PreparationAssistanceState
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';

export interface PreparationAssistanceSelection {
  readonly state: PreparationAssistanceState;
  readonly items: readonly PreparationAssistanceResolution[];
}

interface AssistancePorts {
  readonly admin: Pick<
    FundingAdminService,
    | 'getPreparationAssistance'
    | 'savePreparationAssistanceSource'
    | 'startPreparationAssistanceRun'
    | 'reviewPreparationAssistance'
  >;
  identity(): string;
  permitted(): boolean;
  visible(): boolean;
  changed(selection: PreparationAssistanceSelection): void;
  invalidated(): void;
  unauthorized(): void;
}

/** Private read/review drafts. Jobs and qualification remain server owned. */
export class PreparationAssistanceController {
  readonly data = signal<PreparationAssistanceState | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly title = signal('');
  readonly text = signal('');
  readonly sourceDirty = signal(false);
  readonly sourceConflict = signal(false);
  readonly reviewDirty = signal(false);
  readonly reviewConflict = signal(false);
  readonly items = signal<readonly PreparationAssistanceResolution[]>([]);
  private contributionId = '';
  private identity = '';
  private generation = 0;
  private readSerial = 0;
  private disposed = false;
  private pollStarted = 0;
  private sourceBaseVersion: number | null = null;
  private reviewBaseVersion = 0;
  private refreshKey = '';
  private pendingReload = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly commands = new Map<
    string,
    { signature: string; requestId: string; previousRunId?: string | null }
  >();

  constructor(private readonly ports: AssistancePorts) {}

  select(contributionId: string, refreshKey = ''): void {
    const identity = this.ports.identity();
    if (this.contributionId === contributionId && this.identity === identity) {
      if (this.refreshKey !== refreshKey) {
        this.refreshKey = refreshKey;
        void this.load();
      }
      return;
    }
    ++this.generation;
    ++this.readSerial;
    this.clearTimer();
    this.contributionId = contributionId;
    this.identity = identity;
    this.refreshKey = refreshKey;
    this.pendingReload = false;
    this.data.set(null);
    this.title.set('');
    this.text.set('');
    this.items.set([]);
    this.sourceDirty.set(false);
    this.sourceConflict.set(false);
    this.reviewDirty.set(false);
    this.reviewConflict.set(false);
    this.sourceBaseVersion = null;
    this.reviewBaseVersion = 0;
    this.loading.set(false);
    this.busy.set(false);
    this.error.set('');
    this.commands.clear();
    this.pollStarted = 0;
    this.ports.invalidated();
    if (contributionId && this.ports.permitted()) void this.load();
  }

  setSource(field: 'title' | 'text', value: string): void {
    if (!this.sourceDirty())
      this.sourceBaseVersion = this.data()?.source?.version ?? null;
    this[field].set(value);
    this.sourceDirty.set(true);
  }

  resolve(
    itemId: string,
    patch: Partial<Omit<PreparationAssistanceResolution, 'itemId'>>
  ): void {
    this.markReviewDirty();
    this.items.update((items) =>
      items.map((item) => {
        if (item.itemId !== itemId) return item;
        const next = { ...item, ...patch };
        return next.disposition === 'included'
          ? next
          : { ...next, benefitId: null };
      })
    );
    const state = this.data();
    if (state) this.ports.changed({ state, items: this.items() });
  }
  markReviewDirty(): void {
    if (!this.data()?.run?.suggestion) return;
    if (!this.reviewDirty())
      this.reviewBaseVersion = this.data()?.run?.review?.version ?? 0;
    this.reviewDirty.set(true);
  }
  resetSourceDraft(): void {
    const source = this.data()?.source;
    this.title.set(source?.title ?? '');
    this.text.set(source?.text ?? '');
    this.sourceBaseVersion = source?.version ?? null;
    this.sourceDirty.set(false);
    this.sourceConflict.set(false);
  }
  resetReviewDraft(): void {
    const state = this.data();
    if (!state?.run) return;
    this.reviewBaseVersion = state.run.review?.version ?? 0;
    this.reviewDirty.set(false);
    this.reviewConflict.set(false);
    this.items.set(
      state.run.review?.items ??
        state.run.suggestion?.items.map((item) => ({
          itemId: item.id,
          disposition: 'unresolved' as const,
          benefitId: null,
          note: ''
        })) ??
        []
    );
    this.ports.changed({ state, items: this.items() });
  }

  async load(preserveError = false): Promise<void> {
    if (
      !this.current(this.generation) ||
      !this.ports.permitted() ||
      !this.contributionId
    )
      return;
    if (this.busy() && !preserveError) {
      this.pendingReload = true;
      return;
    }
    this.clearTimer();
    const generation = this.generation;
    const serial = ++this.readSerial;
    this.loading.set(true);
    if (!preserveError) this.error.set('');
    try {
      const result = await this.ports.admin.getPreparationAssistance(
        this.contributionId
      );
      if (!this.current(generation) || serial !== this.readSerial) return;
      this.receive(result);
    } catch (error) {
      if (this.current(generation) && serial === this.readSerial)
        this.failure(error, 'read');
    } finally {
      if (this.current(generation) && serial === this.readSerial) {
        this.loading.set(false);
        this.schedule();
      }
    }
  }

  async saveSource(): Promise<void> {
    const state = this.data();
    if (
      !state?.capabilities.canManageSource ||
      !this.sourceDirty() ||
      this.sourceConflict()
    )
      return;
    const payload = {
      contributionId: this.contributionId,
      expectedSourceVersion: this.sourceBaseVersion,
      title: this.title().trim(),
      text: this.text()
    };
    await this.command('source', payload, (requestId) =>
      this.ports.admin.savePreparationAssistanceSource({
        ...payload,
        requestId
      })
    );
  }

  async analyze(): Promise<void> {
    const state = this.data();
    if (
      !state?.source ||
      !state.capabilities.canRun ||
      this.reviewDirty() ||
      this.sourceDirty()
    )
      return;
    const payload = {
      contributionId: this.contributionId,
      sourceVersion: state.source.version,
      expectedCommitmentVersion: state.commitment.version,
      rerun: !!state.run
    };
    await this.command('run', payload, (requestId) =>
      this.ports.admin.startPreparationAssistanceRun({ ...payload, requestId })
    );
  }

  async review(
    decision: 'save' | 'reject',
    draft: PreparationAssistanceDraft
  ): Promise<void> {
    const state = this.data();
    if (
      !state?.run ||
      !state.capabilities.canReview ||
      state.stale ||
      this.reviewConflict()
    )
      return;
    const payload = {
      contributionId: this.contributionId,
      runId: state.run.id,
      expectedReviewVersion: this.reviewBaseVersion,
      decision,
      draft
    };
    await this.command('review', payload, (requestId) =>
      this.ports.admin.reviewPreparationAssistance({ ...payload, requestId })
    );
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    ++this.readSerial;
    this.clearTimer();
    this.data.set(null);
    this.text.set('');
    this.title.set('');
    this.items.set([]);
    this.commands.clear();
  }

  private current(generation: number): boolean {
    return (
      !this.disposed &&
      generation === this.generation &&
      this.identity === this.ports.identity() &&
      this.ports.permitted()
    );
  }

  private receive(state: PreparationAssistanceState): void {
    if (state.contributionId !== this.contributionId)
      throw new Error('ASSISTANCE_RESPONSE_MISMATCH');
    const pendingRun = this.commands.get('run');
    if (
      pendingRun &&
      pendingRun.previousRunId !== undefined &&
      state.run &&
      state.run.id !== pendingRun.previousRunId
    )
      this.commands.delete('run');
    const previous = this.data();
    const changedRun = previous?.run?.id !== state.run?.id;
    const changedReview =
      previous?.run?.review?.version !== state.run?.review?.version;
    if (this.sourceDirty()) {
      if (this.sourceBaseVersion !== (state.source?.version ?? null))
        this.sourceConflict.set(true);
    } else {
      this.title.set(state.source?.title ?? '');
      this.text.set(state.source?.text ?? '');
      this.sourceBaseVersion = state.source?.version ?? null;
      this.sourceConflict.set(false);
    }
    const receivedSuggestion =
      !previous?.run?.suggestion && !!state.run?.suggestion;
    if (
      this.reviewDirty() &&
      (changedRun ||
        this.reviewBaseVersion !== (state.run?.review?.version ?? 0))
    ) {
      this.reviewConflict.set(true);
    } else if (
      !this.reviewDirty() &&
      (changedRun || changedReview || receivedSuggestion || !previous)
    ) {
      this.reviewBaseVersion = state.run?.review?.version ?? 0;
      this.items.set(
        state.run?.review?.items ??
          state.run?.suggestion?.items.map((item) => ({
            itemId: item.id,
            disposition: 'unresolved' as const,
            benefitId: null,
            note: ''
          })) ??
          []
      );
    }
    if (changedRun) this.pollStarted = 0;
    this.data.set(state);
    this.ports.changed({ state, items: this.items() });
  }

  private async command(
    kind: string,
    payload: object,
    execute: (requestId: string) => Promise<PreparationAssistanceState>
  ): Promise<void> {
    if (!this.current(this.generation) || this.busy() || this.loading()) return;
    this.clearTimer();
    const generation = this.generation;
    const signature = JSON.stringify(payload);
    let command = this.commands.get(kind);
    if (command?.signature !== signature) {
      command = {
        signature,
        requestId: crypto.randomUUID(),
        ...(kind === 'run'
          ? { previousRunId: this.data()?.run?.id ?? null }
          : {})
      };
      this.commands.set(kind, command);
    }
    this.busy.set(true);
    this.error.set('');
    ++this.readSerial;
    try {
      const result = await execute(command.requestId);
      if (!this.current(generation)) return;
      this.commands.delete(kind);
      if (kind === 'source') this.sourceDirty.set(false);
      if (kind === 'review') this.reviewDirty.set(false);
      this.receive(result);
    } catch (error) {
      if (!this.current(generation)) return;
      this.failure(error, 'command');
      if (
        (error as { status?: number }).status !== 401 &&
        (error as { status?: number }).status !== 403
      )
        await this.load(true);
    } finally {
      if (this.current(generation)) {
        this.busy.set(false);
        if (this.pendingReload) {
          this.pendingReload = false;
          await this.load(!!this.error());
        } else this.schedule();
      }
    }
  }

  private failure(error: unknown, operation: 'read' | 'command'): void {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) {
      this.data.set(null);
      this.text.set('');
      this.title.set('');
      this.items.set([]);
      this.commands.clear();
      this.ports.invalidated();
      this.error.set('forbidden');
      if (status === 401) this.ports.unauthorized();
    } else
      this.error.set(
        status === 409
          ? 'stale'
          : operation === 'read'
            ? 'unavailable'
            : 'uncertain'
      );
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.current(this.generation) || this.busy() || this.loading()) return;
    if (!['queued', 'processing'].includes(this.data()?.run?.state ?? ''))
      return;
    this.pollStarted ||= Date.now();
    if (Date.now() - this.pollStarted > 120_000) {
      this.error.set('timeout');
      return;
    }
    this.timer = setTimeout(() => {
      if (this.ports.visible()) void this.load();
      else this.schedule();
    }, 2500);
  }
  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
