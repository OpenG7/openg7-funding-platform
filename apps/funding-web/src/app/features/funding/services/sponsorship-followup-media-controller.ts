import { computed, signal } from '@angular/core';
import type {
  SponsorMediaAsset,
  SponsorMediaKind,
  SponsorMediaLimits
} from '@openg7/funding-core';

import { BlobPreviewResource } from './blob-preview-resource.js';
import type { FundingService } from './funding.service.js';
import {
  getSponsorMediaFileValidationFeedback,
  getSponsorMediaUploadFailureFeedback,
  type SponsorMediaFeedback
} from './sponsor-media-upload-feedback.js';

export interface SponsorshipMediaUploadAttempt {
  readonly id: number;
  readonly filename: string;
  readonly previewUrl: string;
  readonly status: 'queued' | 'uploading' | 'uploaded' | 'failed';
  readonly feedback: SponsorMediaFeedback;
  readonly asset?: SponsorMediaAsset;
}

export interface SponsorshipFollowupMediaPorts {
  readonly service: Pick<
    FundingService,
    | 'getSponsorshipMedia'
    | 'getSponsorshipMediaPreview'
    | 'uploadSponsorshipMedia'
    | 'deleteSponsorshipMedia'
  >;
  readonly token: () => string;
  readonly canUploadMedia: () => boolean;
  readonly isBrowser: () => boolean;
  readonly busyChange: (value: boolean) => void;
  readonly confirmDelete: () => boolean;
}

interface MediaScope {
  readonly token: string;
  readonly generation: number;
}

/** One follow-up's media state; API responses remain authoritative. */
export class SponsorshipFollowupMediaController {
  readonly assets = signal<readonly SponsorMediaAsset[]>([]);
  readonly attempts = signal<readonly SponsorshipMediaUploadAttempt[]>([]);
  readonly previews = signal<Record<string, string>>({});
  readonly limits = signal<SponsorMediaLimits>({
    maxUploadBytes: 8 * 1024 * 1024,
    maxSupportingImages: 3,
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
  });
  readonly busy = signal(false);
  readonly loadError = signal(false);
  readonly loaded = signal(false);
  readonly message = signal<SponsorMediaFeedback | null>(null);
  readonly altText = signal('');
  // An upload is already saved when POST succeeds, even if the next GET fails.
  private readonly savedAssets = computed(() => {
    const assets = new Map(this.assets().map((asset) => [asset.id, asset]));
    for (const attempt of this.attempts()) {
      if (attempt.asset) assets.set(attempt.asset.id, attempt.asset);
    }
    return [...assets.values()];
  });
  readonly hasActiveLogo = computed(() =>
    this.savedAssets().some((asset) => asset.kind === 'logo')
  );
  readonly hasApprovedLogo = computed(() =>
    this.assets().some(
      (asset) => asset.kind === 'logo' && asset.reviewStatus === 'approved'
    )
  );
  readonly photoCount = computed(
    () =>
      this.savedAssets().filter((asset) => asset.kind === 'supporting_image')
        .length
  );
  readonly canAddSupportingImage = computed(
    () => this.photoCount() < this.limits().maxSupportingImages
  );

  private sequence = 0;
  private readSequence = 0;
  private generation = 0;
  private activeToken: string | null = null;
  private disposed = false;
  private readonly resources = new Set<BlobPreviewResource>();
  private readonly attemptResources = new Map<number, BlobPreviewResource>();
  private previewResources = new Map<string, BlobPreviewResource>();

  constructor(private readonly ports: SponsorshipFollowupMediaPorts) {}

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const scope = this.scope();
    if (this.busy()) return;
    this.setBusy(true);
    try {
      await this.loadMedia(scope);
    } finally {
      if (this.isCurrent(scope)) this.setBusy(false);
    }
  }

  async uploadMedia(
    kind: SponsorMediaKind,
    files: readonly File[]
  ): Promise<void> {
    if (this.disposed) return;
    const scope = this.scope();
    if (
      !files.length ||
      this.busy() ||
      !this.ports.canUploadMedia() ||
      !this.loaded() ||
      this.loadError()
    )
      return;
    if (kind === 'logo' && this.hasApprovedLogo()) return;
    const available =
      kind === 'logo'
        ? 1
        : Math.max(0, this.limits().maxSupportingImages - this.photoCount());
    const attempts: SponsorshipMediaUploadAttempt[] = files.map((file) => ({
      id: ++this.sequence,
      filename: file.name,
      previewUrl: '',
      status: 'queued',
      feedback: { key: 'queued' }
    }));
    this.attempts.update((current) => [...current, ...attempts]);
    this.setBusy(true);
    this.message.set({ key: 'uploading' });
    const uploaded: number[] = [];
    let accepted = 0;
    let failed = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (!this.isCurrent(scope)) return;
        const attempt = attempts[index]!;
        const validation = getSponsorMediaFileValidationFeedback(
          file,
          this.limits()
        );
        const failure =
          validation ??
          (accepted >= available
            ? {
                key: 'limit',
                params: {
                  count: kind === 'logo' ? 1 : this.limits().maxSupportingImages
                }
              }
            : null);
        if (failure) {
          failed++;
          this.updateAttempt(attempt.id, {
            status: 'failed',
            feedback: failure
          });
          continue;
        }
        const previewUrl = await this.loadAttemptPreview(attempt.id, file);
        if (!this.isCurrent(scope)) return;
        this.updateAttempt(attempt.id, {
          status: 'uploading',
          previewUrl,
          feedback: { key: 'uploading' }
        });
        try {
          const result = await this.ports.service.uploadSponsorshipMedia(
            scope.token,
            kind,
            file,
            this.altText()
          );
          if (!this.isCurrent(scope)) return;
          accepted++;
          uploaded.push(attempt.id);
          this.updateAttempt(attempt.id, {
            status: 'uploaded',
            asset: result.asset,
            feedback: { key: 'uploaded' }
          });
        } catch (error) {
          if (!this.isCurrent(scope)) return;
          failed++;
          this.updateAttempt(attempt.id, {
            status: 'failed',
            feedback: getSponsorMediaUploadFailureFeedback(error, this.limits())
          });
        }
      }
      if (uploaded.length && (await this.loadMedia(scope))) {
        this.removeAttempts(uploaded);
        this.altText.set('');
      }
      if (this.isCurrent(scope))
        this.message.set({
          key: 'result',
          params: { received: accepted, failed }
        });
    } finally {
      if (this.isCurrent(scope)) this.setBusy(false);
    }
  }

  async deleteMedia(asset: SponsorMediaAsset): Promise<boolean> {
    if (this.disposed) return false;
    const scope = this.scope();
    if (
      this.busy() ||
      !this.ports.canUploadMedia() ||
      asset.reviewStatus === 'approved'
    )
      return false;
    if (!this.ports.isBrowser() || !this.ports.confirmDelete()) return false;
    this.setBusy(true);
    try {
      const result = await this.ports.service.deleteSponsorshipMedia({
        token: scope.token,
        assetId: asset.id,
        expectedVersion: asset.version,
        confirmed: true
      });
      if (!this.isCurrent(scope)) return false;
      if (!result.deleted) throw new Error('Deletion not confirmed.');
      this.assets.update((assets) =>
        assets.filter((item) => item.id !== asset.id)
      );
      const preview = this.previewResources.get(asset.id);
      if (preview) this.release(preview);
      this.previewResources.delete(asset.id);
      this.previews.update((previews) => {
        const remaining = { ...previews };
        delete remaining[asset.id];
        return remaining;
      });
      this.message.set({ key: 'deleted' });
      await this.loadMedia(scope);
      return this.isCurrent(scope);
    } catch {
      if (this.isCurrent(scope)) this.message.set({ key: 'deleteError' });
      return false;
    } finally {
      if (this.isCurrent(scope)) this.setBusy(false);
    }
  }

  async dismiss(attempt: SponsorshipMediaUploadAttempt): Promise<void> {
    if (this.disposed) return;
    const scope = this.scope();
    if (this.busy()) return;
    if (attempt.asset && !(await this.deleteMedia(attempt.asset))) return;
    if (this.isCurrent(scope)) this.removeAttempts([attempt.id]);
  }

  setAltText(value: string): void {
    if (!this.disposed) this.altText.set(value.slice(0, 300));
  }

  private async loadMedia(scope: MediaScope): Promise<boolean> {
    const sequence = ++this.readSequence;
    this.loadError.set(false);
    try {
      const response = await this.ports.service.getSponsorshipMedia(
        scope.token
      );
      if (!this.isCurrent(scope) || sequence !== this.readSequence)
        return false;
      this.assets.set(response.assets);
      this.limits.set(response.limits);
      this.loaded.set(true);
      this.removeAttempts(
        this.attempts()
          .filter(
            (attempt) =>
              attempt.asset &&
              response.assets.some((asset) => asset.id === attempt.asset!.id)
          )
          .map((attempt) => attempt.id)
      );
      await this.loadPreviews(response.assets, scope, sequence);
      return this.isCurrent(scope) && sequence === this.readSequence;
    } catch {
      if (this.isCurrent(scope) && sequence === this.readSequence)
        this.loadError.set(true);
      return false;
    }
  }

  private async loadPreviews(
    assets: readonly SponsorMediaAsset[],
    scope: MediaScope,
    sequence: number
  ): Promise<void> {
    if (!this.ports.isBrowser()) return;
    const resources = new Map<string, BlobPreviewResource>();
    await Promise.all(
      assets.map(async (asset) => {
        const resource = this.createResource();
        resources.set(asset.id, resource);
        await resource.load(
          async () => {
            const blob = await this.ports.service.getSponsorshipMediaPreview(
              scope.token,
              asset.id
            );
            if (!this.isCurrent(scope) || sequence !== this.readSequence)
              throw new Error('Obsolete media preview.');
            return blob;
          },
          () => {}
        );
      })
    );
    if (!this.isCurrent(scope) || sequence !== this.readSequence) {
      for (const resource of resources.values()) this.release(resource);
      return;
    }
    for (const resource of this.previewResources.values())
      this.release(resource);
    this.previewResources = resources;
    this.previews.set(
      Object.fromEntries(
        [...resources].flatMap(([id, resource]) =>
          resource.url() ? [[id, resource.url()]] : []
        )
      )
    );
  }

  private async loadAttemptPreview(id: number, file: File): Promise<string> {
    if (!this.ports.isBrowser()) return '';
    const resource = this.createResource();
    this.attemptResources.set(id, resource);
    await resource.load(
      async () => file,
      () => {}
    );
    return resource.url();
  }

  private updateAttempt(
    id: number,
    update: Partial<SponsorshipMediaUploadAttempt>
  ): void {
    if (update.status === 'failed' && update.feedback?.key === 'limit') {
      const resource = this.attemptResources.get(id);
      if (resource) this.release(resource);
      this.attemptResources.delete(id);
      update = { ...update, previewUrl: '' };
    }
    this.attempts.update((attempts) =>
      attempts.map((attempt) =>
        attempt.id === id ? { ...attempt, ...update } : attempt
      )
    );
  }

  private removeAttempts(ids: readonly number[]): void {
    for (const id of ids) {
      const resource = this.attemptResources.get(id);
      if (resource) this.release(resource);
      this.attemptResources.delete(id);
    }
    this.attempts.update((attempts) =>
      attempts.filter((attempt) => !ids.includes(attempt.id))
    );
  }

  private createResource(): BlobPreviewResource {
    const resource = new BlobPreviewResource();
    this.resources.add(resource);
    return resource;
  }

  private release(resource: BlobPreviewResource): void {
    resource.dispose();
    this.resources.delete(resource);
  }

  private scope(): MediaScope {
    const token = this.ports.token();
    if (this.activeToken !== null && this.activeToken !== token) {
      this.generation++;
      this.readSequence++;
      this.releaseResources();
      this.assets.set([]);
      this.attempts.set([]);
      this.previews.set({});
      this.loaded.set(false);
      this.loadError.set(false);
      this.message.set(null);
      this.altText.set('');
      if (this.busy()) this.setBusy(false);
    }
    this.activeToken = token;
    return { token, generation: this.generation };
  }

  private isCurrent(scope: MediaScope): boolean {
    return (
      !this.disposed &&
      scope.generation === this.generation &&
      scope.token === this.ports.token()
    );
  }

  private setBusy(value: boolean): void {
    this.busy.set(value);
    this.ports.busyChange(value);
  }

  private releaseResources(): void {
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.attemptResources.clear();
    this.previewResources.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.readSequence++;
    this.releaseResources();
  }
}
