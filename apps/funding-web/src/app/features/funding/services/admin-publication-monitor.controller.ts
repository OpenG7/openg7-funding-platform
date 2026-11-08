import { signal } from '@angular/core';
import type {
  AdminSponsorshipProgress,
  PreflightDeskService,
  PublicationWorkshopState
} from '@openg7/funding-core';

import type { FundingAdminService } from './funding-admin.service.js';

/** Read-only, session-scoped tracking. A refresh never prepares or adopts content. */
export class AdminPublicationMonitorController {
  readonly progress = signal<AdminSponsorshipProgress | null>(null);
  readonly workshop = signal<PublicationWorkshopState | null>(null);
  readonly services = signal<readonly PreflightDeskService[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly queueError = signal(false);
  readonly checkedAt = signal<string | null>(null);
  private context = '';
  private contributionId = '';
  private identity = '';
  private serial = 0;
  private cancellation?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private pollStarted = 0;
  private disposed = false;

  constructor(
    private readonly admin: Pick<
      FundingAdminService,
      | 'publicationWorkshop'
      | 'preflightDesk'
      | 'hasValidAdminSession'
      | 'clearAdminSession'
      | 'identity'
      | 'sessionGeneration'
      | 'getSponsorshipProgress'
      | 'getSavedAdminToken'
    >
  ) {}

  async load(
    contributionId: string,
    reference: string,
    context: string
  ): Promise<void> {
    if (this.disposed) return;
    const deniedError = ['session', 'forbidden', 'not_found'].includes(
      this.error()
    )
      ? this.error()
      : '';
    const identity = this.identityKey();
    if (
      context !== this.context ||
      contributionId !== this.contributionId ||
      identity !== this.identity
    ) {
      this.reset();
      this.context = context;
      this.contributionId = contributionId;
      this.identity = identity;
      if (deniedError) this.error.set(deniedError);
    }
    this.cancellation?.abort();
    clearTimeout(this.timer);
    const serial = ++this.serial;
    const selected = () =>
      !this.disposed &&
      serial === this.serial &&
      context === this.context &&
      contributionId === this.contributionId;
    const current = () =>
      selected() &&
      identity === this.identityKey() &&
      this.admin.hasValidAdminSession();
    if (!this.admin.hasValidAdminSession()) {
      this.reset();
      this.error.set('session');
      return;
    }
    const cancellation = new AbortController();
    this.cancellation = cancellation;
    const signal = AbortSignal.any([
      cancellation.signal,
      AbortSignal.timeout(15000)
    ]);
    this.loading.set(true);
    const results = await Promise.allSettled([
      this.admin.publicationWorkshop.read(contributionId, signal),
      this.admin.preflightDesk.read(
        { page: 1, pageSize: 50, stage: 'all', search: reference },
        signal
      ),
      this.admin.getSponsorshipProgress(
        this.admin.getSavedAdminToken(),
        contributionId,
        signal
      )
    ]);
    if (!current()) {
      if (selected()) {
        const expired = !this.admin.hasValidAdminSession();
        this.reset();
        if (expired) this.error.set('session');
      }
      return;
    }
    const denied = [401, 403].flatMap((status) =>
      results.filter(
        (result) =>
          result.status === 'rejected' &&
          (result.reason as { status?: number }).status === status
      )
    )[0];
    if (denied?.status === 'rejected') {
      const expired = (denied.reason as { status?: number }).status === 401;
      this.reset();
      this.error.set(expired ? 'session' : 'forbidden');
      if (expired) this.admin.clearAdminSession();
      return;
    }
    const [workshop, desk, progress] = results;
    if (
      (progress.status === 'fulfilled' &&
        ['empty', 'not_found'].includes(progress.value.status)) ||
      (progress.status === 'rejected' &&
        (progress.reason as { status?: number }).status === 404)
    ) {
      this.reset();
      this.context = context;
      this.contributionId = contributionId;
      this.identity = identity;
      this.error.set('not_found');
      return;
    }
    const progressValid =
      progress.status === 'fulfilled' &&
      progress.value.status === 'ok' &&
      progress.value.dossier?.contributionId === contributionId;
    if (progressValid) this.progress.set(progress.value.dossier);
    const workshopValid =
      workshop.status === 'fulfilled' &&
      workshop.value.contributionId === contributionId;
    if (
      workshop.status === 'fulfilled' &&
      workshop.value.contributionId === contributionId
    ) {
      this.workshop.set(workshop.value);
    }
    if (desk.status === 'fulfilled') {
      this.services.set(
        desk.value.orders
          .filter((order) => order.contributionId === contributionId)
          .flatMap((order) => order.services)
          .filter((service) => service.contributionId === contributionId)
      );
      this.queueError.set(false);
    } else {
      // Retain no stale membership: it must be observed in the current queue.
      this.services.set([]);
      this.queueError.set(true);
    }
    if (
      progressValid &&
      workshopValid &&
      (!deniedError || desk.status === 'fulfilled')
    ) {
      this.error.set('');
      this.checkedAt.set(new Date().toISOString());
    } else this.error.set(deniedError || 'unavailable');
    this.loading.set(false);
    const mission = this.workshop()?.mission;
    const running =
      mission &&
      !mission.errorCode &&
      (['queued', 'sending'].includes(mission.delivery) ||
        [
          'pending',
          'queued',
          'planning',
          'ready',
          'running',
          'processing',
          'received',
          'waiting_dependency'
        ].includes(mission.status));
    if (running) {
      this.pollStarted ||= Date.now();
      if (Date.now() - this.pollStarted < 120000)
        this.timer = setTimeout(() => {
          if (current()) void this.load(contributionId, reference, context);
          else if (selected()) this.reset();
        }, 5000);
    } else this.pollStarted = 0;
  }

  reset(): void {
    ++this.serial;
    this.cancellation?.abort();
    clearTimeout(this.timer);
    this.pollStarted = 0;
    this.context = '';
    this.contributionId = '';
    this.identity = '';
    this.workshop.set(null);
    this.progress.set(null);
    this.services.set([]);
    this.checkedAt.set(null);
    this.loading.set(false);
    this.error.set('');
    this.queueError.set(false);
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  private identityKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'token'}`;
  }
}
