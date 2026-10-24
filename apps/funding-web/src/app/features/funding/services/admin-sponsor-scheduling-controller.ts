import { computed, signal } from '@angular/core';
import type {
  PublicationAutomationCommand,
  PublicationAutomationFilter,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationFeedId
} from '@openg7/funding-core';

import { AdminPublicationAutomationCommandWorkflow } from '../components/admin-publications/admin-publication-automation-command-workflow.js';
import { PublicationDeliveryController } from '../components/admin-publications/publication-delivery-controller.js';
import type {
  PublicationAutomationCommandContext,
  PublicationAutomationCommandResult
} from '../components/admin-publications/publication-automation.ports.js';

import type { FundingAdminService } from './funding-admin.service.js';
import type { FundingI18nService } from './funding-i18n.service.js';
import type { FundingModerationService } from './funding-moderation.service.js';
import { AdminDashboardRequestError } from './funding-admin-session.js';

export interface AdminSponsorSchedulingPorts {
  readonly admin: Pick<
    FundingAdminService,
    | 'publicationAutomation'
    | 'publicationMedia'
    | 'publicationImagePreview'
    | 'getSponsorMediaPreview'
    | 'getSavedAdminToken'
  >;
  readonly i18n: Pick<FundingI18nService, 't' | 'currentLanguage'>;
  moderate: FundingModerationService['requestDecision'];
  confirm(message: string, title: string): Promise<boolean>;
  changed(): void;
}

/** Dossier-scoped proposals and exact delivery review, without automatic mutations. */
export class AdminSponsorSchedulingController {
  readonly state = signal<PublicationAutomationState | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  private readonly sponsorshipId = signal('');
  readonly entries = computed(() =>
    (this.state()?.queue?.entries ?? []).filter(
      (entry) => entry.sponsorshipId === this.sponsorshipId()
    )
  );
  readonly candidates = computed(() =>
    (this.state()?.preparationCandidates ?? []).filter(
      (candidate) => candidate.sponsorshipId === this.sponsorshipId()
    )
  );
  readonly delivery: PublicationDeliveryController;
  private readonly workflow: AdminPublicationAutomationCommandWorkflow;
  private revision = 0;
  private readGeneration = 0;
  private openingGeneration = 0;
  private disposed = false;

  constructor(private readonly ports: AdminSponsorSchedulingPorts) {
    this.delivery = new PublicationDeliveryController({
      state: this.state,
      busy: this.busy,
      error: this.error,
      commands: { run: (command) => this.run(command) },
      admin: ports.admin,
      i18n: ports.i18n,
      moderate: (subject, level, initial) =>
        ports.moderate(subject, level, initial),
      confirm: (message, title) => ports.confirm(message, title),
      refresh: () => this.refresh(),
      clearError: () => this.error.set(''),
      showError: (error) => this.showError(error)
    });
    this.workflow = new AdminPublicationAutomationCommandWorkflow({
      api: {
        execute: async (command) =>
          (await ports.admin.publicationAutomation(
            command
          )) as PublicationAutomationCommandResult,
        read: (filter) => this.readState(filter, this.revision)
      },
      state: { busy: this.busy, error: this.error, notice: this.notice },
      capture: () => {
        this.readGeneration++;
        this.openingGeneration++;
        this.loading.set(false);
        return {
          revision: this.revision,
          filter: { sponsorshipId: this.sponsorshipId() }
        };
      },
      isCurrent: (context) => this.isCurrent(context),
      applyState: (next) => {
        this.readGeneration++;
        this.loading.set(false);
        this.applyState(next);
      },
      showError: (error) => this.showError(error),
      confirmed: (command) => {
        if (command.action === 'prepare') {
          const ids = [
            ...new Set(
              this.entries().flatMap((item) =>
                item.feedId === command.feedId && item.deliveryId
                  ? [item.deliveryId]
                  : []
              )
            )
          ];
          const job = ids.length === 1 ? this.findDelivery(ids[0]!) : undefined;
          if (job?.feedId === command.feedId) this.delivery.open(job);
        } else if ('id' in command) {
          const selected = this.delivery.selected();
          const job = this.findDelivery(command.id);
          if (job && selected?.id === command.id) this.delivery.open(job);
        }
        this.ports.changed();
      }
    });
  }

  load(sponsorshipId: string): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (sponsorshipId !== this.sponsorshipId()) {
      this.revision++;
      this.readGeneration++;
      this.sponsorshipId.set(sponsorshipId);
      this.state.set(null);
      this.loading.set(false);
      this.error.set('');
      this.notice.set('');
      this.clearDelivery();
    }
    return this.refresh();
  }

  async refresh(): Promise<boolean> {
    if (this.disposed || !this.sponsorshipId()) return false;
    const generation = ++this.readGeneration;
    const revision = this.revision;
    const selected = this.delivery.selected();
    const isCurrent = () =>
      this.currentRead(generation, revision) &&
      this.delivery.selected() === selected;
    this.loading.set(true);
    try {
      const next = await this.readState(
        { sponsorshipId: this.sponsorshipId() },
        revision,
        isCurrent
      );
      if (!isCurrent()) return false;
      if (!this.applyState(next, true)) this.error.set('');
      return true;
    } catch (error) {
      if (isCurrent() && !this.clearDeniedAccess(error))
        this.error.set('admin.dossier.publicationBridge.schedule.loadFailed');
      return false;
    } finally {
      if (this.currentRead(generation, revision)) this.loading.set(false);
    }
  }

  async open(deliveryId: string, editDate = false): Promise<void> {
    if (this.disposed || this.busy() || !this.state() || this.delivery.dirty())
      return;
    const generation = ++this.openingGeneration;
    const revision = this.revision;
    const selected = this.delivery.selected();
    const isCurrent = () =>
      this.currentOpening(generation, revision) &&
      this.delivery.selected() === selected;
    let job = this.findDelivery(deliveryId);
    if (!job) {
      try {
        const next = await this.readState(
          { sponsorshipId: this.sponsorshipId(), deliveryId },
          revision,
          isCurrent
        );
        if (!isCurrent() || this.busy() || this.delivery.dirty()) return;
        job = this.scopedState(next).deliveries.find(
          (item) => item.id === deliveryId
        );
        if (job) {
          const cached = this.findDelivery(deliveryId);
          if (cached && cached.version > job.version) job = cached;
          const current = this.state();
          if (!current) return;
          this.state.set({
            ...current,
            deliveries: [
              ...current.deliveries.filter((item) => item.id !== deliveryId),
              job
            ]
          });
        }
      } catch {
        if (isCurrent())
          this.error.set('admin.dossier.publicationBridge.schedule.loadFailed');
        return;
      }
    }
    if (!job) {
      this.error.set(
        'admin.dossier.publicationBridge.schedule.missingDelivery'
      );
      return;
    }
    this.error.set('');
    this.delivery.open(job);
    if (editDate && this.delivery.editable()) this.delivery.editing.set(true);
  }

  async prepare(feedId: PublicationFeedId): Promise<void> {
    const unavailable = () =>
      this.disposed ||
      this.busy() ||
      this.loading() ||
      Boolean(this.delivery.selected()) ||
      !this.canPrepare(feedId);
    if (unavailable()) return;
    const revision = this.revision;
    if (
      !(await this.ports.confirm(
        this.ports.i18n.t(
          'admin.dossier.publicationBridge.schedule.prepareConfirm'
        ),
        feedId
      )) ||
      revision !== this.revision ||
      unavailable()
    )
      return;
    await this.workflow.run({ action: 'prepare', feedId });
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    this.readGeneration++;
    this.loading.set(false);
    this.clearDelivery();
    this.delivery.dispose();
  }

  private canPrepare(feedId: PublicationFeedId): boolean {
    return (
      this.entries().some(
        (entry) =>
          entry.feedId === feedId &&
          (entry.nextOpportunity
            ? entry.nextOpportunity.action === 'PREPARE_FEED'
            : entry.reason === 'AWAITING_PREPARATION')
      ) ||
      this.candidates().some(
        (candidate) =>
          candidate.feedId === feedId &&
          candidate.nextOpportunity.action === 'PREPARE_FEED'
      )
    );
  }

  private async readState(
    filter: PublicationAutomationFilter,
    revision: number,
    isCurrent = () => this.currentRevision(revision)
  ): Promise<PublicationAutomationState> {
    const selected = this.delivery.selected();
    const next = await this.readAutomation(filter, isCurrent);
    if (
      filter.deliveryId ||
      !selected ||
      !isCurrent() ||
      this.delivery.selected() !== selected ||
      next.deliveries.some((job) => job.id === selected.id)
    )
      return next;
    const exact = await this.readAutomation(
      { ...filter, deliveryId: selected.id },
      isCurrent
    );
    return {
      ...next,
      deliveries: [
        ...next.deliveries,
        ...exact.deliveries.filter((job) => job.id === selected.id)
      ]
    };
  }

  private async readAutomation(
    filter: PublicationAutomationFilter,
    isCurrent: () => boolean
  ): Promise<PublicationAutomationState> {
    try {
      return (await this.ports.admin.publicationAutomation(
        undefined,
        filter
      )) as PublicationAutomationState;
    } catch (error) {
      if (isCurrent()) this.clearDeniedAccess(error);
      throw error;
    }
  }

  private async run(command: PublicationAutomationCommand): Promise<boolean> {
    if (this.disposed || this.busy() || !('id' in command)) return false;
    const selected = this.delivery.selected();
    const job = this.findDelivery(command.id);
    if (
      !job ||
      selected?.id !== job.id ||
      selected.version !== job.version ||
      command.version !== job.version
    ) {
      this.showError(new Error('VERSION_CONFLICT'));
      return false;
    }
    return this.workflow.run(command);
  }

  private findDelivery(id: string): PublicationDelivery | undefined {
    return this.state()?.deliveries.find(
      (job) =>
        job.id === id &&
        job.sponsors.some((sponsor) => sponsor.id === this.sponsorshipId())
    );
  }

  private applyState(
    next: PublicationAutomationState,
    refreshSelection = false
  ): boolean {
    this.state.set(this.scopedState(next));
    const selected = this.delivery.selected();
    if (!selected) return false;
    const refreshed = this.findDelivery(selected.id);
    if (!refreshed) {
      this.clearDelivery();
      this.error.set(
        'admin.dossier.publicationBridge.schedule.missingDelivery'
      );
      return true;
    }
    if (
      refreshSelection &&
      !this.delivery.dirty() &&
      (refreshed.version !== selected.version ||
        refreshed.status !== selected.status)
    )
      this.delivery.open(refreshed);
    return false;
  }

  private scopedState(
    next: PublicationAutomationState
  ): PublicationAutomationState {
    const sponsorshipId = this.sponsorshipId();
    return {
      ...next,
      deliveries: next.deliveries.filter((job) =>
        job.sponsors.some((sponsor) => sponsor.id === sponsorshipId)
      ),
      ...(next.preparationCandidates
        ? {
            preparationCandidates: next.preparationCandidates.filter(
              (candidate) => candidate.sponsorshipId === sponsorshipId
            )
          }
        : {}),
      ...(next.queue
        ? {
            queue: {
              ...next.queue,
              entries: next.queue.entries.filter(
                (entry) => entry.sponsorshipId === sponsorshipId
              )
            }
          }
        : {})
    };
  }

  private currentRead(generation: number, revision: number): boolean {
    return this.currentRevision(revision) && generation === this.readGeneration;
  }

  private currentOpening(generation: number, revision: number): boolean {
    return (
      this.currentRevision(revision) && generation === this.openingGeneration
    );
  }

  private currentRevision(revision: number): boolean {
    return !this.disposed && revision === this.revision;
  }

  private isCurrent(context: PublicationAutomationCommandContext): boolean {
    return !this.disposed && context.revision === this.revision;
  }

  private clearDelivery(): void {
    this.openingGeneration++;
    this.delivery.clear();
    this.delivery.edit = {
      message: '',
      scheduledAt: '',
      mediaId: '',
      publicationFormat: 'collective_text',
      photoSelections: []
    };
  }

  private clearDeniedAccess(error: unknown): boolean {
    if (
      !(error instanceof AdminDashboardRequestError) ||
      ![401, 403].includes(error.status)
    )
      return false;
    this.revision++;
    this.readGeneration++;
    this.loading.set(false);
    this.state.set(null);
    this.notice.set('');
    this.clearDelivery();
    this.error.set('admin.privacy.forbidden');
    return true;
  }

  private showError(error: unknown): void {
    if (this.clearDeniedAccess(error)) return;
    const code = error instanceof Error ? error.message : '';
    if (
      code === 'SOURCE_CONTENT_MISSING' &&
      this.delivery.selected()?.status === 'uncertain'
    ) {
      this.error.set('admin.publicationAutomation.sourceContentUncertain');
      return;
    }
    const key = [
      'VERSION_CONFLICT',
      'SOURCE_CHANGED',
      'SOURCE_CONTENT_MISSING',
      'MEDIA_CHANGED',
      'SOURCE_NOT_ELIGIBLE',
      'SPONSOR_APPROVAL_REQUIRED',
      'SPONSOR_REVIEW_REQUIRED',
      'SPONSOR_MEDIA_REQUIRED',
      'CONNECTION_REQUIRED',
      'APPROVAL_UNAVAILABLE',
      'DESTINATION_CHANGED',
      'MEDIA_NOT_APPROVED',
      'LEGACY_DELIVERY_EXISTS',
      'INVALID_MESSAGE',
      'POST_MISMATCH',
      'REMOTE_POST_UNVERIFIED',
      'MEDIA_RECONCILIATION_REQUIRED',
      'COLLECTION_REQUIRES_MULTIPLE_SPONSORS'
    ].includes(code)
      ? code
      : 'generic';
    this.error.set(`admin.publicationAutomation.errors.${key}`);
  }
}
