import { computed, signal } from '@angular/core';
import type {
  SponsorMediaWorkspace,
  SponsorMediaWorkspaceAsset,
  SponsorMediaBatchAction,
  SponsorMediaBatchPlan,
  SponsorMediaBatchExecuteRequest,
  SponsorMediaBatchReceipt,
  SponsorMediaRuleRequest,
  SponsorMediaBatchRequest,
  SponsorMediaAnalysisRun,
  SponsorMediaClassification
} from '@openg7/funding-core';
import type { SponsorMediaBatchPlanRequest } from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export type MediaReviewFilter =
  'all' | 'ready' | 'needs_review' | 'blocked' | 'approved' | 'rejected';
interface MediaReviewDraft {
  version: string;
  altText: string;
  restrictions: boolean;
  classification: SponsorMediaClassification;
  edited: boolean;
  restoredRunId?: string;
  restoredReviewVersion?: number;
}
interface MediaReviewPorts {
  admin: Pick<
    FundingAdminService,
    | 'mediaWorkspace'
    | 'mediaBatchPlan'
    | 'mediaBatchExecute'
    | 'mediaRules'
    | 'mediaBatch'
    | 'mediaReceipt'
  >;
  permitted(): boolean;
  changed(): void;
  unauthorized(): void;
}

/** One dossier's presentation and commands. The server owns readiness and exact batch decisions. */
export class MediaReviewWorkspaceController {
  readonly data = signal<SponsorMediaWorkspace | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly filter = signal<MediaReviewFilter>('all');
  readonly search = signal('');
  readonly batchFilter = signal('');
  readonly page = signal(1);
  readonly pageSize = 25;
  readonly selectedIds = signal<readonly string[]>([]);
  readonly inspectedId = signal<string | null>(null);
  readonly plan = signal<SponsorMediaBatchPlan | null>(null);
  readonly receipt = signal<SponsorMediaBatchReceipt | null>(null);
  readonly pending = signal<SponsorMediaBatchExecuteRequest | null>(null);
  readonly uncertain = signal(false);
  readonly uncertainRequest = signal<string | null>(null);
  readonly notice = signal('');
  readonly drafts = signal<Readonly<Record<string, MediaReviewDraft>>>({});
  readonly assets = computed(() => this.data()?.assets ?? []);
  readonly counts = computed(() => {
    const assets = this.assets();
    return {
      all: assets.length,
      ready: assets.filter(
        (asset) =>
          asset.reviewStatus !== 'approved' && asset.readiness.state === 'ready'
      ).length,
      needs_review: assets.filter(
        (asset) =>
          asset.reviewStatus !== 'approved' &&
          asset.readiness.state === 'needs_review'
      ).length,
      blocked: assets.filter(
        (asset) =>
          asset.reviewStatus !== 'approved' &&
          asset.readiness.state === 'blocked'
      ).length,
      approved: assets.filter((asset) => asset.reviewStatus === 'approved')
        .length,
      rejected: assets.filter((asset) => asset.reviewStatus === 'rejected')
        .length
    };
  });
  readonly filtered = computed(() => {
    const filter = this.filter(),
      search = this.search().trim().toLocaleLowerCase(),
      batch = this.batchFilter();
    return this.assets().filter(
      (asset) =>
        (!batch || asset.batchId === batch) &&
        (filter === 'all' ||
          (filter === 'approved' || filter === 'rejected'
            ? asset.reviewStatus === filter
            : asset.reviewStatus !== 'approved' &&
              asset.readiness.state === filter)) &&
        (!search ||
          [asset.originalFilename, asset.altText, asset.id]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase()
            .includes(search))
    );
  });
  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / this.pageSize))
  );
  readonly currentPage = computed(() =>
    Math.min(this.page(), this.pageCount())
  );
  readonly visible = computed(() =>
    this.filtered().slice(
      (this.currentPage() - 1) * this.pageSize,
      this.currentPage() * this.pageSize
    )
  );
  readonly inspected = computed(
    () => this.assets().find((asset) => asset.id === this.inspectedId()) ?? null
  );
  readonly selected = computed(() =>
    this.assets().filter((asset) => this.selectedIds().includes(asset.id))
  );
  readonly canWrite = computed(
    () =>
      !!this.data()?.writable &&
      this.ports.permitted() &&
      !this.busy() &&
      !this.uncertain()
  );
  private contributionId = '';
  private generation = 0;
  private readGeneration = 0;
  private disposed = false;

  constructor(private readonly ports: MediaReviewPorts) {}

  setScope(contributionId: string): void {
    if (contributionId === this.contributionId) return;
    this.generation++;
    this.readGeneration++;
    this.contributionId = contributionId;
    this.data.set(null);
    this.selectedIds.set([]);
    this.inspectedId.set(null);
    this.drafts.set({});
    this.plan.set(null);
    this.pending.set(null);
    this.uncertain.set(false);
    this.uncertainRequest.set(null);
    this.notice.set('');
    this.receipt.set(null);
    this.error.set('');
    this.busy.set(false);
    this.loading.set(false);
    this.filter.set('all');
    this.search.set('');
    this.batchFilter.set('');
    this.page.set(1);
  }

  async load(): Promise<void> {
    if (!this.contributionId || this.disposed) return;
    const generation = this.generation,
      read = ++this.readGeneration;
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.ports.admin.mediaWorkspace(this.contributionId);
      if (!this.current(generation) || read !== this.readGeneration) return;
      this.data.set(data);
      this.selectedIds.update((ids) =>
        ids.filter((id) => data.assets.some((asset) => asset.id === id))
      );
      if (!data.assets.some((asset) => asset.id === this.inspectedId()))
        this.inspectedId.set(null);
    } catch (error) {
      if (this.current(generation) && read === this.readGeneration)
        this.fail(error, 'loadFailed');
    } finally {
      if (this.current(generation) && read === this.readGeneration)
        this.loading.set(false);
    }
  }

  toggle(id: string): void {
    if (this.busy() || this.uncertain()) return;
    this.selectedIds.update((ids) =>
      ids.includes(id)
        ? ids.filter((item) => item !== id)
        : ids.length < 100
          ? [...ids, id]
          : ids
    );
  }
  selectPage(): void {
    if (this.busy() || this.uncertain()) return;
    this.selectedIds.set(
      [
        ...new Set([
          ...this.selectedIds(),
          ...this.visible().map((asset) => asset.id)
        ])
      ].slice(0, 100)
    );
  }
  selectReady(): void {
    if (this.busy() || this.uncertain()) return;
    this.selectedIds.set(
      this.filtered()
        .filter(
          (asset) =>
            asset.readiness.state === 'ready' &&
            asset.reviewStatus !== 'approved'
        )
        .slice(0, 100)
        .map((asset) => asset.id)
    );
  }
  draft(asset: SponsorMediaWorkspaceAsset): MediaReviewDraft {
    const draft = this.drafts()[asset.id];
    return draft?.version === asset.version
      ? draft
      : {
          version: asset.version,
          altText: asset.altText ?? '',
          restrictions: !!asset.usageRestrictionsReviewed,
          classification: 'unknown',
          edited: false
        };
  }
  edit(
    asset: SponsorMediaWorkspaceAsset,
    update: {
      altText?: string;
      restrictions?: boolean;
      classification?: SponsorMediaClassification;
    }
  ): void {
    if (!this.canWrite()) return;
    this.drafts.update((drafts) => ({
      ...drafts,
      [asset.id]: { ...this.draft(asset), ...update, edited: true }
    }));
    this.plan.set(null);
  }

  restoreSavedAnalysisDraft(
    asset: SponsorMediaWorkspaceAsset,
    run: SponsorMediaAnalysisRun | null
  ): void {
    const review = run?.review,
      current = this.drafts()[asset.id];
    if (
      !run ||
      run.assetId !== asset.id ||
      run.stale ||
      run.state !== 'succeeded' ||
      review?.decision !== 'saved' ||
      !this.assets().some(
        (item) => item.id === asset.id && item.version === asset.version
      ) ||
      (current?.version === asset.version &&
        (current.edited ||
          (current.restoredRunId === run.id &&
            current.restoredReviewVersion === review.version)))
    )
      return;
    this.drafts.update((drafts) => ({
      ...drafts,
      [asset.id]: {
        ...this.draft(asset),
        altText: review.draft.altText ?? '',
        classification: review.draft.classification,
        edited: false,
        restoredRunId: run.id,
        restoredReviewVersion: review.version
      }
    }));
  }

  async prepare(
    action: SponsorMediaBatchAction,
    options: Pick<
      SponsorMediaBatchPlanRequest,
      | 'targetBatchId'
      | 'ruleId'
      | 'reason'
      | 'internalReason'
      | 'sponsorExplanation'
    > = {},
    only?: SponsorMediaWorkspaceAsset
  ): Promise<void> {
    const data = this.data(),
      assets = only ? [only] : this.selected();
    if (!data || !this.canWrite() || !assets.length) return;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    this.receipt.set(null);
    this.plan.set(null);
    try {
      const plan = await this.ports.admin.mediaBatchPlan({
        requestId: crypto.randomUUID(),
        contributionId: data.contributionId,
        expectedRevision: data.revision,
        action,
        assets: assets.map((asset) => ({
          id: asset.id,
          version: asset.version,
          ...(action === 'approve'
            ? {
                altText: this.draft(asset).altText.trim() || null,
                ...(this.draft(asset).restrictions
                  ? { usageRestrictionsConfirmed: true as const }
                  : {})
              }
            : {})
        })),
        ...options
      });
      if (this.current(generation)) this.plan.set(plan);
    } catch (error) {
      if (this.current(generation)) this.fail(error, 'planFailed');
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }

  async execute(): Promise<void> {
    const plan = this.plan();
    if (
      !plan ||
      this.busy() ||
      this.uncertain() ||
      !this.canWrite() ||
      plan.blocked.length ||
      Date.parse(plan.expiresAt) <= Date.now()
    )
      return;
    const command: SponsorMediaBatchExecuteRequest = {
      requestId: crypto.randomUUID(),
      planId: plan.id,
      confirmation: plan.id,
      humanReviewed: true
    };
    this.pending.set(command);
    this.uncertainRequest.set(command.requestId);
    this.busy.set(true);
    this.error.set('');
    const generation = this.generation;
    try {
      const receipt = await this.ports.admin.mediaBatchExecute(command);
      if (!this.current(generation)) return;
      this.receipt.set(receipt);
      this.pending.set(null);
      this.uncertainRequest.set(null);
      this.plan.set(null);
      this.selectedIds.set([]);
      this.drafts.set({});
      this.ports.changed();
      await this.load();
    } catch (error) {
      if (!this.current(generation)) return;
      if (
        error instanceof AdminDashboardRequestError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        this.pending.set(null);
        this.uncertainRequest.set(null);
        this.plan.set(null);
        this.fail(error, 'changed');
        await this.load();
        if (!this.error()) this.error.set('changed');
      } else {
        this.uncertain.set(true);
        this.error.set('uncertain');
      }
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }

  async saveRules(request: SponsorMediaRuleRequest): Promise<boolean> {
    return this.mutate(request.requestId, () =>
      this.ports.admin.mediaRules(request)
    );
  }
  async createBatch(request: SponsorMediaBatchRequest): Promise<boolean> {
    return this.mutate(request.requestId, () =>
      this.ports.admin.mediaBatch(request)
    );
  }
  async reconcile(): Promise<void> {
    const requestId = this.uncertainRequest(),
      contributionId = this.contributionId;
    if (!requestId || !this.uncertain() || this.busy()) return;
    const generation = this.generation;
    this.busy.set(true);
    try {
      const response = await this.ports.admin.mediaReceipt(
        contributionId,
        requestId
      );
      if (!this.current(generation)) return;
      if (!response.found) {
        this.notice.set('noReceipt');
        return;
      }
      const result = response.result;
      if (
        result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status === 'completed' &&
        'items' in result
      )
        this.receipt.set(result as SponsorMediaBatchReceipt);
      this.pending.set(null);
      this.uncertainRequest.set(null);
      this.uncertain.set(false);
      this.plan.set(null);
      this.error.set('');
      this.notice.set('reconciled');
      this.selectedIds.set([]);
      this.ports.changed();
      await this.load();
    } catch (error) {
      if (this.current(generation)) this.fail(error, 'uncertain');
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }
  private async mutate(
    requestId: string,
    command: () => Promise<SponsorMediaWorkspace>
  ): Promise<boolean> {
    if (!this.canWrite()) return false;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    this.uncertainRequest.set(requestId);
    try {
      const data = await command();
      if (!this.current(generation)) return false;
      this.data.set(data);
      this.uncertainRequest.set(null);
      this.plan.set(null);
      this.ports.changed();
      return true;
    } catch (error) {
      if (this.current(generation)) {
        if (
          !(error instanceof AdminDashboardRequestError) ||
          error.status >= 500
        )
          this.uncertain.set(true);
        this.fail(error, this.uncertain() ? 'uncertain' : 'changed');
        if (
          !this.uncertain() &&
          error instanceof AdminDashboardRequestError &&
          error.status === 409
        ) {
          await this.load();
          if (!this.error()) this.error.set('changed');
        }
      }
      return false;
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }
  private fail(error: unknown, fallback: string): void {
    if (
      error instanceof AdminDashboardRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      this.data.set(null);
      this.selectedIds.set([]);
      this.inspectedId.set(null);
      this.plan.set(null);
      this.error.set(error.status === 401 ? 'unauthorized' : 'forbidden');
      if (error.status === 401) this.ports.unauthorized();
    } else this.error.set(fallback);
  }
  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.readGeneration++;
  }
}
