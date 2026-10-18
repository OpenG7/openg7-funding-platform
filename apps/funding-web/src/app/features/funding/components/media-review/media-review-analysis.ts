import { computed, signal } from '@angular/core';
import {
  sponsorMediaAnalysisPrefill,
  type SponsorMediaWorkspaceAsset,
  type SponsorMediaAnalysisRun,
  type SponsorMediaAnalysisResponse
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

import type { MediaReviewWorkspaceController } from './media-review-workspace.controller.js';

interface MediaReviewAnalysisPorts {
  admin: Pick<
    FundingAdminService,
    | 'getSponsorMediaAnalyses'
    | 'getSponsorMediaAnalysisReceipt'
    | 'startSponsorMediaAnalysis'
    | 'reviewSponsorMediaAnalysis'
  >;
  controller: MediaReviewWorkspaceController;
  contributionId(): string;
  refresh(): Promise<void>;
  changed(): void;
}

/** Local analysis requests and reviews; an uncertain mutation is only reconciled by receipt. */
export class MediaReviewAnalysis {
  readonly busy = signal(false);
  readonly readLoading = signal(false);
  readonly receiptRequest = signal<{
    contributionId: string;
    requestId: string;
  } | null>(null);
  readonly stop = signal(false);
  readonly progress = signal<{ completed: number; total: number } | null>(null);
  readonly polls = signal(0);
  readonly error = signal(false);
  readonly runs = signal<readonly SponsorMediaAnalysisRun[]>([]);
  readonly capabilities = signal('not_configured');
  readonly run = computed(
    () =>
      this.runs().find((run) => run.assetId === this.c.inspectedId()) ?? null
  );
  private generation = 0;
  private epoch = 0;
  private read = 0;
  private destroyed = false;

  constructor(private readonly ports: MediaReviewAnalysisPorts) {}
  private get c(): MediaReviewWorkspaceController {
    return this.ports.controller;
  }
  private get admin(): MediaReviewAnalysisPorts['admin'] {
    return this.ports.admin;
  }
  private contributionId(): string {
    return this.ports.contributionId();
  }
  reset(): void {
    this.generation++;
    this.epoch++;
    this.read++;
    this.runs.set([]);
    this.receiptRequest.set(null);
    this.stop.set(false);
    this.progress.set(null);
    this.polls.set(0);
    this.readLoading.set(false);
    this.busy.set(false);
  }
  dispose(): void {
    this.destroyed = true;
    this.generation++;
  }
  analysisFor(id: string): SponsorMediaAnalysisRun | undefined {
    return this.runs().find((run) => run.assetId === id);
  }
  async reconcile(): Promise<void> {
    const pending = this.receiptRequest(),
      generation = this.generation;
    if (pending) {
      if (this.busy()) return;
      this.busy.set(true);
      try {
        const receipt = await this.admin.getSponsorMediaAnalysisReceipt(
          pending.contributionId,
          pending.requestId
        );
        if (this.destroyed || generation !== this.generation) return;
        if (!receipt.found) {
          this.c.notice.set('noReceipt');
          return;
        }
        this.receiptRequest.set(null);
        this.c.uncertain.set(false);
        this.c.error.set('');
        this.c.notice.set('reconciled');
        await this.ports.refresh();
        this.ports.changed();
      } catch {
        if (!this.destroyed && generation === this.generation)
          this.error.set(true);
      } finally {
        if (!this.destroyed && generation === this.generation)
          this.busy.set(false);
      }
      return;
    }
  }
  async loadAnalyses(): Promise<void> {
    const generation = this.generation,
      epoch = this.epoch,
      read = ++this.read,
      id = this.contributionId();
    this.readLoading.set(true);
    try {
      const response = await this.admin.getSponsorMediaAnalyses(id);
      if (
        this.destroyed ||
        generation !== this.generation ||
        epoch !== this.epoch ||
        read !== this.read
      )
        return;
      this.runs.set(response.runs);
      this.capabilities.set(response.capabilities.vision);
      this.error.set(false);
    } catch {
      if (
        !this.destroyed &&
        generation === this.generation &&
        epoch === this.epoch &&
        read === this.read
      )
        this.error.set(true);
    } finally {
      if (
        !this.destroyed &&
        generation === this.generation &&
        read === this.read
      )
        this.readLoading.set(false);
    }
  }
  private applyAnalysisMutation(response: SponsorMediaAnalysisResponse): void {
    // A read started before this mutation cannot replace its confirmed response.
    this.epoch++;
    this.runs.set(response.runs);
    this.capabilities.set(response.capabilities.vision);
    this.error.set(false);
  }
  async analyze(): Promise<void> {
    const asset = this.c.inspected();
    if (asset) await this.startAnalyses([asset]);
  }
  async analyzeSelection(): Promise<void> {
    await this.startAnalyses(this.c.selected());
  }
  private async startAnalyses(
    assets: readonly SponsorMediaWorkspaceAsset[]
  ): Promise<void> {
    if (!assets.length || !this.c.canWrite()) return;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set(false);
    this.stop.set(false);
    this.polls.set(0);
    this.progress.set({ completed: 0, total: assets.length });
    try {
      for (const asset of assets) {
        if (this.destroyed || generation !== this.generation || this.stop())
          break;
        const request = {
          requestId: crypto.randomUUID(),
          contributionId: asset.contributionId,
          assetId: asset.id,
          expectedVersion: asset.version,
          rerun: !!this.analysisFor(asset.id)
        };
        try {
          this.epoch++;
          const response = await this.admin.startSponsorMediaAnalysis(request);
          if (this.destroyed || generation !== this.generation) return;
          this.applyAnalysisMutation(response);
          this.progress.update((progress) =>
            progress ? { ...progress, completed: progress.completed + 1 } : null
          );
        } catch (error) {
          if (this.destroyed || generation !== this.generation) return;
          this.error.set(true);
          if (
            !(error instanceof AdminDashboardRequestError) ||
            error.status >= 500
          ) {
            this.receiptRequest.set({
              contributionId: asset.contributionId,
              requestId: request.requestId
            });
            this.c.uncertain.set(true);
            this.c.error.set('uncertain');
            await this.loadAnalyses();
            break;
          }
          if (
            error.status === 401 ||
            error.status === 403 ||
            error.status === 429
          )
            break;
        }
      }
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.busy.set(false);
    }
  }
  prefill(): void {
    const asset = this.c.inspected();
    if (!asset || !this.c.canWrite()) return;
    const draft = sponsorMediaAnalysisPrefill(
      this.run(),
      !this.c.drafts()[asset.id]
    );
    if (draft) {
      this.c.edit(asset, {
        altText: draft.altText ?? this.c.draft(asset).altText,
        classification: draft.classification
      });
    }
  }
  async reviewAnalysis(decision: 'save' | 'reject' | 'accept'): Promise<void> {
    const asset = this.c.inspected(),
      run = this.run(),
      generation = this.generation;
    if (
      !asset ||
      !run ||
      !this.c.canWrite() ||
      run.stale ||
      run.state !== 'succeeded' ||
      (run.review && run.review.decision !== 'saved')
    )
      return;
    this.busy.set(true);
    this.error.set(false);
    const requestId = crypto.randomUUID();
    try {
      this.epoch++;
      const response = await this.admin.reviewSponsorMediaAnalysis({
        requestId,
        contributionId: asset.contributionId,
        runId: run.id,
        expectedVersion: asset.version,
        expectedReviewVersion: run.review?.version ?? 0,
        decision,
        confirmation: asset.id,
        draft: {
          altText: this.c.draft(asset).altText.trim() || null,
          classification: this.c.draft(asset).classification
        }
      });
      if (!this.destroyed && generation === this.generation) {
        this.applyAnalysisMutation(response);
        await this.ports.refresh();
        this.ports.changed();
      }
    } catch (error) {
      if (!this.destroyed && generation === this.generation) {
        this.error.set(true);
        if (
          !(error instanceof AdminDashboardRequestError) ||
          error.status >= 500
        ) {
          this.receiptRequest.set({
            contributionId: asset.contributionId,
            requestId
          });
          this.c.uncertain.set(true);
          this.c.error.set('uncertain');
        }
      }
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.busy.set(false);
    }
  }
}
