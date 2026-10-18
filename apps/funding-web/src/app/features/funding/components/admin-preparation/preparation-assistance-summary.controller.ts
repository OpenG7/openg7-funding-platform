import { signal } from '@angular/core';
import {
  preparationAssistanceActions,
  type PreparationAssistanceSummary
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';

interface SummaryPorts {
  readonly admin: Pick<
    FundingAdminService,
    'getPreparationAssistanceSummary' | 'rerunPreparationAssistanceSummary'
  >;
  identity(): string;
  permitted(): boolean;
  visible(): boolean;
  unauthorized(): void;
}

/** Owner-only compact facts. Neither the guide nor the receipt loads source text or human drafts. */
export class PreparationAssistanceSummaryController {
  readonly data = signal<PreparationAssistanceSummary | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  private contributionId = '';
  private identity = '';
  private generation = 0;
  private serial = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pollStarted = 0;
  private command: {
    signature: string;
    requestId: string;
    previousRunId: string | null;
  } | null = null;
  private refreshKey = '';
  private pendingReload = false;

  constructor(private readonly ports: SummaryPorts) {}

  select(contributionId: string, refreshKey = ''): void {
    const identity = this.ports.identity();
    if (
      this.contributionId === contributionId &&
      this.identity === identity &&
      this.ports.permitted()
    ) {
      if (refreshKey !== this.refreshKey) {
        this.refreshKey = refreshKey;
        if (this.busy()) this.pendingReload = true;
        else void this.load();
      }
      return;
    }
    ++this.generation;
    ++this.serial;
    this.stopTimer();
    this.contributionId = contributionId;
    this.identity = identity;
    this.refreshKey = refreshKey;
    this.data.set(null);
    this.loading.set(false);
    this.busy.set(false);
    this.error.set('');
    this.command = null;
    this.pollStarted = 0;
    this.pendingReload = false;
    if (contributionId && this.ports.permitted()) void this.load();
  }

  async load(preserveError = false): Promise<void> {
    if (!this.current(this.generation) || !this.contributionId) return;
    if (this.busy() && !preserveError) {
      this.pendingReload = true;
      return;
    }
    this.stopTimer();
    const generation = this.generation,
      serial = ++this.serial;
    this.loading.set(true);
    if (!preserveError) this.error.set('');
    try {
      const result = await this.ports.admin.getPreparationAssistanceSummary(
        this.contributionId
      );
      if (!this.current(generation) || serial !== this.serial) return;
      this.receive(result);
    } catch (error) {
      if (this.current(generation) && serial === this.serial)
        this.failure(error, false);
    } finally {
      if (this.current(generation) && serial === this.serial) {
        this.loading.set(false);
        this.schedule();
      }
    }
  }

  async rerun(expectedRevision: string): Promise<void> {
    const before = this.data();
    if (
      !this.current(this.generation) ||
      !before ||
      before.revision !== expectedRevision ||
      this.loading() ||
      this.busy() ||
      !before.sourceVersion ||
      !preparationAssistanceActions(before, {
        permitted: true,
        busy: false
      }).some((action) => action.id === 'rerun' && action.enabled)
    )
      return;
    this.stopTimer();
    const generation = this.generation;
    const payload = {
      contributionId: this.contributionId,
      sourceVersion: before.sourceVersion,
      expectedCommitmentVersion: before.commitmentVersion,
      rerun: true
    };
    const signature = JSON.stringify(payload);
    if (this.command?.signature !== signature)
      this.command = {
        signature,
        requestId: crypto.randomUUID(),
        previousRunId: before.run?.id ?? null
      };
    this.busy.set(true);
    this.error.set('');
    ++this.serial;
    try {
      const result = await this.ports.admin.rerunPreparationAssistanceSummary({
        ...payload,
        requestId: this.command.requestId
      });
      if (!this.current(generation)) return;
      this.command = null;
      this.receive(result);
    } catch (error) {
      if (!this.current(generation)) return;
      this.failure(error, true);
      const status = (error as { status?: number }).status;
      if (status !== 401 && status !== 403) {
        await this.load(true);
      }
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

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    ++this.serial;
    this.stopTimer();
    this.data.set(null);
    this.command = null;
  }
  private current(generation: number): boolean {
    return (
      !this.disposed &&
      generation === this.generation &&
      this.identity === this.ports.identity() &&
      this.ports.permitted()
    );
  }
  private receive(result: PreparationAssistanceSummary): void {
    if (
      result.contributionId !== this.contributionId ||
      result.controlCode !== 'accepted_offer'
    )
      throw new Error('ASSISTANCE_RESPONSE_MISMATCH');
    if (
      this.command &&
      result.run &&
      result.run.id !== this.command.previousRunId
    )
      this.command = null;
    if (result.run?.id !== this.data()?.run?.id) this.pollStarted = 0;
    this.data.set(result);
  }
  private failure(error: unknown, mutation: boolean): void {
    const status = (error as { status?: number }).status;
    this.data.set(null);
    this.error.set(
      status === 401 || status === 403
        ? 'forbidden'
        : status === 409
          ? 'stale'
          : mutation
            ? 'uncertain'
            : 'unavailable'
    );
    if (status === 401 || status === 403) this.command = null;
    if (status === 401) this.ports.unauthorized();
  }
  private schedule(): void {
    this.stopTimer();
    if (
      !this.current(this.generation) ||
      this.busy() ||
      this.loading() ||
      !['queued', 'processing'].includes(this.data()?.run?.state ?? '')
    )
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
  private stopTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
