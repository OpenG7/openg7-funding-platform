import { computed, signal } from '@angular/core';
import type {
  SponsorMediaApproveAllExecuteRequest,
  SponsorMediaApproveAllPlan,
  SponsorMediaApproveAllReceipt,
  SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import { BlobPreviewResource } from '../../services/blob-preview-resource.js';

import type { MediaReviewWorkspaceController } from './media-review-workspace.controller.js';
import { MediaPreviewCollection } from './media-preview-collection.js';

export interface MediaReviewApproveAllPorts {
  readonly admin: Pick<
    FundingAdminService,
    | 'mediaApproveAllPlan'
    | 'mediaApproveAllExecute'
    | 'mediaApproveAllReceipt'
    | 'mediaThumbnail'
    | 'getSponsorMediaPreview'
    | 'getSavedAdminToken'
  >;
  readonly controller: MediaReviewWorkspaceController;
  /** Independent of this operation's own busy/unresolved lock. */
  permitted(): boolean;
  refresh(): Promise<void>;
  changed(): void;
  unauthorized(): void;
  storage?(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  newRequestId?(): string;
}

/** One server-owned dossier manifest and explicit confirmation; no selected-file shortcut. */
export class MediaReviewApproveAll {
  readonly opened = signal(false);
  readonly busy = signal(false);
  readonly plan = signal<SponsorMediaApproveAllPlan | null>(null);
  readonly receipt = signal<SponsorMediaApproveAllReceipt | null>(null);
  readonly error = signal('');
  readonly pendingRequestId = signal<string | null>(null);
  private readonly resumeVerified = signal(false);
  readonly unresolved = computed(() => this.pendingRequestId() !== null);
  readonly canOpen = computed(
    () =>
      this.ports.permitted() && !this.busy() && !this.ports.controller.loading()
  );
  readonly eligible = computed(
    () =>
      this.plan()?.candidates.filter(
        (item) => item.classification === 'eligible'
      ) ?? []
  );
  readonly unchanged = computed(
    () =>
      this.plan()?.candidates.filter(
        (item) => item.classification !== 'eligible'
      ) ?? []
  );
  readonly previews: MediaPreviewCollection;
  private readonly displayed = signal<readonly string[]>([]);
  readonly previewsReady = computed(() => {
    const items = this.eligible(),
      displayed = this.displayed();
    return (
      items.length > 0 &&
      items.every(({ asset }) => {
        const key = this.previews.key(asset.id, asset.version),
          preview = this.previews.previews()[key];
        return !!preview?.url && !preview.failed && displayed.includes(key);
      })
    );
  });
  readonly failedPreviews = computed(
    () =>
      this.eligible().filter(
        ({ asset }) =>
          this.previews.previews()[this.previews.key(asset.id, asset.version)]
            ?.failed
      ).length
  );
  readonly canConfirm = computed(() => {
    const plan = this.plan(),
      data = this.ports.controller.data();
    return (
      !!plan &&
      this.error() !== 'expired' &&
      this.ports.permitted() &&
      !this.busy() &&
      !this.unresolved() &&
      data?.contributionId === plan.contributionId &&
      data.revision === plan.revision &&
      Date.parse(plan.expiresAt) > Date.now() &&
      this.previewsReady()
    );
  });
  readonly canResume = computed(
    () =>
      this.ports.permitted() &&
      !this.busy() &&
      this.resumeVerified() &&
      !!this.pendingRequestId() &&
      this.receipt()?.status === 'in_progress'
  );
  readonly previewAsset = signal<SponsorMediaWorkspaceAsset | null>(null);
  readonly previewFailed = signal(false);
  private readonly fullPreview = new BlobPreviewResource();
  readonly previewUrl = this.fullPreview.url;
  private contributionId = '';
  private identityKey = '';
  private generation = 0;
  private disposed = false;
  private pendingCommand: SponsorMediaApproveAllExecuteRequest | null = null;

  constructor(private readonly ports: MediaReviewApproveAllPorts) {
    this.previews = new MediaPreviewCollection((id) =>
      ports.admin.mediaThumbnail(id)
    );
  }

  setScope(contributionId: string, identityKey: string): void {
    if (
      contributionId === this.contributionId &&
      identityKey === this.identityKey
    )
      return;
    ++this.generation;
    this.contributionId = contributionId;
    this.identityKey = identityKey;
    this.opened.set(false);
    this.busy.set(false);
    this.plan.set(null);
    this.receipt.set(null);
    this.error.set('');
    this.pendingCommand = null;
    this.resumeVerified.set(false);
    this.pendingRequestId.set(null);
    this.clearPreviews();
    if (!contributionId) return;
    try {
      const marker = this.ports.storage?.()?.getItem(this.storageKey());
      if (marker) {
        this.pendingRequestId.set(marker);
        if (!this.uuid(marker)) this.error.set('receiptUnavailable');
      }
    } catch {
      // In-memory confirmation remains authoritative if browser storage is unavailable.
    }
  }

  async prepare(): Promise<void> {
    if (this.disposed || this.busy()) return;
    if (this.unresolved()) {
      this.opened.set(true);
      return;
    }
    const data = this.ports.controller.data();
    if (
      !this.ports.permitted() ||
      !data ||
      data.contributionId !== this.contributionId
    )
      return;
    const generation = this.generation;
    this.opened.set(true);
    this.busy.set(true);
    this.error.set('');
    this.plan.set(null);
    this.receipt.set(null);
    this.clearPreviews();
    try {
      const plan = await this.ports.admin.mediaApproveAllPlan({
        requestId: this.newId(),
        contributionId: this.contributionId,
        expectedRevision: data.revision
      });
      if (!this.current(generation)) return;
      if (!this.validPlan(plan, data.revision))
        throw new Error('Unexpected approval manifest.');
      this.plan.set(plan);
      this.requestPreviews();
    } catch (error) {
      if (this.current(generation)) this.fail(error, 'prepareFailed');
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }

  async confirm(): Promise<void> {
    const plan = this.plan();
    if (plan && Date.parse(plan.expiresAt) <= Date.now()) {
      this.error.set('expired');
      return;
    }
    if (!plan || !this.canConfirm() || !this.ports.permitted()) return;
    let command: SponsorMediaApproveAllExecuteRequest;
    try {
      command = {
        requestId: this.newId(),
        planId: plan.id,
        confirmation: plan.id,
        humanReviewed: true
      };
      if (!this.retainMarker(command.requestId)) return;
    } catch {
      this.error.set('executeFailed');
      return;
    }
    this.pendingCommand = command;
    this.pendingRequestId.set(command.requestId);
    await this.execute(command, true);
  }

  async reconcile(): Promise<void> {
    const requestId = this.pendingRequestId();
    if (
      !requestId ||
      !this.uuid(requestId) ||
      !this.ports.permitted() ||
      this.busy()
    )
      return;
    const generation = this.generation;
    this.busy.set(true);
    this.resumeVerified.set(false);
    this.error.set('');
    try {
      const response = await this.ports.admin.mediaApproveAllReceipt(
        this.contributionId,
        requestId
      );
      if (!this.current(generation)) return;
      if (!response.found) {
        this.error.set('receiptNotFound');
        return;
      }
      if (
        !this.validReceipt(
          response.result,
          requestId,
          this.pendingCommand?.planId
        )
      )
        throw new Error('Unexpected approval receipt.');
      await this.applyReceipt(response.result, generation);
    } catch (error) {
      if (this.current(generation)) this.fail(error, 'receiptUnavailable');
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }

  async resume(): Promise<void> {
    const receipt = this.receipt(),
      requestId = this.pendingRequestId();
    if (!receipt || !requestId || !this.canResume() || !this.ports.permitted())
      return;
    const command: SponsorMediaApproveAllExecuteRequest = {
      requestId,
      planId: receipt.planId,
      confirmation: receipt.planId,
      humanReviewed: true
    };
    this.pendingCommand = command;
    await this.execute(command);
  }

  previewLoaded(id: string, version: string): void {
    const key = this.previews.key(id, version),
      preview = this.previews.previews()[key];
    if (
      !preview?.url ||
      preview.failed ||
      !this.eligible().some(
        ({ asset }) => asset.id === id && asset.version === version
      )
    )
      return;
    this.displayed.update((keys) =>
      keys.includes(key) ? keys : [...keys, key]
    );
  }

  markPreviewFailed(id: string, version: string): void {
    if (
      !this.eligible().some(
        ({ asset }) => asset.id === id && asset.version === version
      )
    )
      return;
    const key = this.previews.key(id, version);
    const preview = this.previews.previews()[key];
    if (preview?.url) URL.revokeObjectURL(preview.url);
    this.previews.previews.update((items) => ({
      ...items,
      [key]: { url: '', failed: true }
    }));
    this.displayed.update((keys) => keys.filter((item) => item !== key));
  }

  retryPreviews(): void {
    if (!this.plan() || this.busy() || this.unresolved()) return;
    this.clearPreviews();
    this.requestPreviews();
  }

  openPreview(asset: SponsorMediaWorkspaceAsset): void {
    if (
      this.busy() ||
      !this.eligible().some(
        (item) =>
          item.asset.id === asset.id && item.asset.version === asset.version
      )
    )
      return;
    this.previewAsset.set(asset);
    this.previewFailed.set(false);
    void this.fullPreview.load(
      () =>
        this.ports.admin.getSponsorMediaPreview(
          this.ports.admin.getSavedAdminToken(),
          asset.id
        ),
      () => this.previewFailed.set(true)
    );
  }

  closePreview(): void {
    this.previewAsset.set(null);
    this.previewFailed.set(false);
    this.fullPreview.clear();
  }

  close(): void {
    if (this.busy()) return;
    this.opened.set(false);
    this.plan.set(null);
    this.clearPreviews();
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    this.previews.dispose();
    this.fullPreview.dispose();
  }

  private async execute(
    command: SponsorMediaApproveAllExecuteRequest,
    initialConfirmation = false
  ): Promise<void> {
    const generation = this.generation;
    this.busy.set(true);
    this.resumeVerified.set(false);
    this.error.set('');
    this.closePreview();
    try {
      const receipt = await this.ports.admin.mediaApproveAllExecute(command);
      if (!this.current(generation)) return;
      if (!this.validReceipt(receipt, command.requestId, command.planId))
        throw new Error('Unexpected approval receipt.');
      await this.applyReceipt(receipt, generation);
    } catch (error) {
      if (!this.current(generation)) return;
      if (
        initialConfirmation &&
        !this.receipt() &&
        this.pendingRequestId() === command.requestId &&
        error instanceof AdminDashboardRequestError &&
        error.status === 409 &&
        (error.code === 'MEDIA_PLAN_EXPIRED' ||
          error.code === 'MEDIA_NO_ELIGIBLE_ASSETS')
      ) {
        // These codes are emitted only before start, after the backend replay check.
        // An acknowledged operation or any other uncertain response stays locked.
        try {
          const storage = this.ports.storage?.();
          if (storage?.getItem(this.storageKey()) === command.requestId)
            storage.removeItem(this.storageKey());
        } catch {
          // Browser storage may be unavailable; the known refusal releases local state.
        }
        this.pendingRequestId.set(null);
        this.pendingCommand = null;
        this.plan.set(null);
        this.clearPreviews();
        this.error.set(
          error.code === 'MEDIA_PLAN_EXPIRED' ? 'expired' : 'noEligible'
        );
        return;
      }
      this.fail(error, 'uncertain');
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }

  private async applyReceipt(
    receipt: SponsorMediaApproveAllReceipt,
    generation: number
  ): Promise<void> {
    this.receipt.set(receipt);
    this.resumeVerified.set(receipt.status === 'in_progress');
    this.plan.set(null);
    this.clearPreviews();
    this.error.set('');
    if (receipt.status !== 'in_progress') {
      try {
        const storage = this.ports.storage?.();
        if (storage?.getItem(this.storageKey()) === receipt.requestId)
          storage.removeItem(this.storageKey());
      } catch {
        // A retained marker can be reconciled again without repeating the mutation.
      }
      this.pendingRequestId.set(null);
      this.pendingCommand = null;
    }
    this.ports.changed();
    try {
      await this.ports.refresh();
    } catch {
      if (this.current(generation)) this.error.set('refreshFailed');
    }
    if (!this.current(generation)) return;
  }

  private requestPreviews(): void {
    const assets = this.eligible().map((item) => item.asset);
    this.previews.retain(
      assets.map((asset) => this.previews.key(asset.id, asset.version))
    );
    for (const asset of assets) this.previews.request(asset.id, asset.version);
  }

  private clearPreviews(): void {
    this.displayed.set([]);
    this.previews.clear();
    this.closePreview();
  }

  private retainMarker(requestId: string): boolean {
    try {
      const storage = this.ports.storage?.(),
        previous = storage?.getItem(this.storageKey());
      if (previous && previous !== requestId) {
        this.pendingRequestId.set(previous);
        this.error.set('otherOperation');
        return false;
      }
      storage?.setItem(this.storageKey(), requestId);
    } catch {
      // The in-memory request still prevents duplicate execution in this workspace.
    }
    return true;
  }

  private storageKey(): string {
    return 'openg7-media-approve-all-pending:' + this.contributionId;
  }
  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
  private uuid(value: string): boolean {
    return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  }
  private newId(): string {
    const value = this.ports.newRequestId?.() ?? crypto.randomUUID();
    if (!this.uuid(value)) throw new Error('Invalid operation identifier.');
    return value;
  }

  private validPlan(
    plan: SponsorMediaApproveAllPlan,
    revision: string
  ): boolean {
    if (
      plan.kind !== 'approve_all' ||
      !plan.id ||
      plan.contributionId !== this.contributionId ||
      plan.revision !== revision ||
      !Number.isFinite(Date.parse(plan.expiresAt)) ||
      !Array.isArray(plan.candidates) ||
      !plan.summary
    )
      return false;
    const ids = new Set<string>();
    for (const item of plan.candidates) {
      if (
        !item.asset?.id ||
        !item.asset.version ||
        item.asset.contributionId !== this.contributionId ||
        ids.has(item.asset.id) ||
        !Array.isArray(item.reasons) ||
        ![
          'eligible',
          'blocked',
          'already_approved',
          'not_processable'
        ].includes(item.classification)
      )
        return false;
      ids.add(item.asset.id);
    }
    const count = (kind: string) =>
      plan.candidates.filter((item) => item.classification === kind).length;
    return (
      plan.summary.total === plan.candidates.length &&
      plan.summary.eligible === count('eligible') &&
      plan.summary.blocked === count('blocked') &&
      plan.summary.alreadyApproved === count('already_approved') &&
      plan.summary.notProcessable === count('not_processable')
    );
  }

  private validReceipt(
    receipt: SponsorMediaApproveAllReceipt,
    requestId: string,
    planId?: string
  ): boolean {
    if (
      receipt?.kind !== 'approve_all' ||
      receipt.requestId !== requestId ||
      !receipt.planId ||
      (planId && receipt.planId !== planId) ||
      receipt.contributionId !== this.contributionId ||
      !['in_progress', 'completed', 'partial'].includes(receipt.status) ||
      !receipt.summary ||
      !Array.isArray(receipt.items)
    )
      return false;
    const ids = new Set<string>();
    for (const item of receipt.items) {
      if (
        !item.id ||
        ids.has(item.id) ||
        !Array.isArray(item.reasons) ||
        ![
          'approved',
          'already_approved',
          'blocked',
          'not_processable',
          'failed',
          'pending'
        ].includes(item.result)
      )
        return false;
      ids.add(item.id);
    }
    const expectedIds =
      this.plan()?.id === receipt.planId
        ? this.plan()!.candidates.map((item) => item.asset.id)
        : this.receipt()?.planId === receipt.planId
          ? this.receipt()!.items.map((item) => item.id)
          : null;
    if (
      expectedIds &&
      (expectedIds.length !== ids.size ||
        expectedIds.some((id) => !ids.has(id)))
    )
      return false;
    const count = (kind: string) =>
      receipt.items.filter((item) => item.result === kind).length;
    return (
      receipt.summary.total === receipt.items.length &&
      receipt.summary.approved === count('approved') &&
      receipt.summary.alreadyApproved === count('already_approved') &&
      receipt.summary.blocked === count('blocked') &&
      receipt.summary.notProcessable === count('not_processable') &&
      receipt.summary.failed === count('failed') &&
      receipt.summary.pending === count('pending') &&
      (receipt.status === 'in_progress' || receipt.summary.pending === 0)
    );
  }

  private fail(error: unknown, fallback: string): void {
    if (error instanceof AdminDashboardRequestError && error.status === 401) {
      this.error.set('unauthorized');
      this.plan.set(null);
      this.receipt.set(null);
      this.clearPreviews();
      this.ports.unauthorized();
    } else if (
      error instanceof AdminDashboardRequestError &&
      error.status === 403
    )
      this.error.set('forbidden');
    else if (
      error instanceof AdminDashboardRequestError &&
      error.status === 409 &&
      !this.unresolved()
    )
      this.error.set('changed');
    else this.error.set(fallback);
  }
}
