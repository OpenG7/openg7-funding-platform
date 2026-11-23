import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import type {
  SponsorMediaWorkspace,
  SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingModerationService } from '../../services/funding-moderation.service.js';
import type { ModerationRequest } from '../../services/funding-moderation.service.js';
import { BlobPreviewResource } from '../../services/blob-preview-resource.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import { MediaPreviewCollection } from '../../components/media-review/media-preview-collection.js';
import { MediaReviewThumbnailComponent } from '../../components/media-review/media-review-thumbnail.component.js';
import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';

/** Dossier-scoped gallery; approval and later individual withdrawal use native review contracts. */
@Component({
  selector: 'openg7-pilot-dossier-media',
  standalone: true,
  imports: [MediaReviewThumbnailComponent, AdminDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      data-og7="pilot-dossier-media"
      [attr.aria-busy]="loading() || busy()"
    >
      <h3>{{ t('photos') }} · {{ photos().length }}</h3>
      @if (loading()) {
        <p role="status">{{ t('loading') }}</p>
      }
      @if (failed()) {
        <p role="alert">{{ t('mediaUnavailable') }}</p>
        <button type="button" (click)="load()">{{ t('refresh') }}</button>
      }
      <div class="photo-grid">
        @for (asset of photos(); track asset.id) {
          <article data-og7="pilot-photo" [attr.data-og7-id]="asset.id">
            <button
              class="photo-preview"
              type="button"
              (click)="enlarge(asset)"
              [disabled]="disabled() || busy()"
              [attr.aria-label]="
                t('enlargePhoto') + ' : ' + asset.originalFilename
              "
            >
              <openg7-media-review-thumbnail
                [assetId]="asset.id"
                [version]="asset.version"
                [alt]="asset.altText || asset.originalFilename"
                [collection]="previews"
              />
            </button>
            <strong>{{ asset.originalFilename }}</strong>
            <span [class.approved]="asset.reviewStatus === 'approved'">{{
              t('mediaStatus.' + asset.reviewStatus)
            }}</span>
            @if (asset.reviewStatus === 'approved' && canReview()) {
              <button
                type="button"
                (click)="disapprove(asset)"
                [disabled]="disabled() || busy()"
                data-og7="pilot-photo-disapprove"
              >
                {{ t('disapprovePhoto') }}
              </button>
            }
          </article>
        }
      </div>
      @if (!loading() && !failed() && !photos().length) {
        <p>{{ t('noPhotos') }}</p>
      }
    </section>
    <openg7-admin-drawer
      [opened]="!!selected()"
      [title]="selected()?.originalFilename || t('photos')"
      [closeLabel]="t('close')"
      (closed)="selected.set(null)"
    >
      @if (selected(); as asset) {
        @if (fullPreview.url(); as url) {
          <img
            class="full-photo"
            [src]="url"
            [alt]="asset.altText || asset.originalFilename"
          />
        } @else {
          <p role="status">
            {{ t(fullFailed() ? 'mediaUnavailable' : 'loading') }}
          </p>
        }
        <p>{{ asset.altText }}</p>
      }
    </openg7-admin-drawer>
  `,
  styles: [
    `
      :host {
        display: block;
        margin-top: 1rem;
      }
      .full-photo {
        display: block;
        width: 100%;
        height: auto;
        object-fit: contain;
      }
      .photo-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 1rem;
      }
      article {
        min-width: 0;
        padding: 0.6rem;
        border: 1px solid var(--admin-border);
        border-radius: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      strong {
        overflow-wrap: anywhere;
        font-size: 0.9rem;
      }
      .photo-preview {
        padding: 0;
        width: 100%;
        height: 10rem;
        overflow: hidden;
      }
      button {
        color: var(--admin-text);
        background: var(--admin-panel);
        border: 1px solid var(--admin-control-border);
        border-radius: 0.5rem;
        min-height: 2.75rem;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      button:focus-visible {
        outline: 3px solid var(--admin-focus);
        outline-offset: 2px;
      }
      span {
        color: var(--admin-muted);
      }
      .approved {
        color: var(--og7-admin-success, #256044);
      }
      @media (max-width: 700px) {
        .photo-grid {
          grid-template-columns: repeat(
            auto-fit,
            minmax(min(12rem, 100%), 1fr)
          );
        }
      }
    `
  ]
})
export class PilotDossierMediaComponent {
  readonly contributionId = input.required<string>();
  readonly refreshKey = input(0);
  readonly disabled = input(false);
  readonly workspaceChanged = output<SponsorMediaWorkspace | null>();
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly moderation = inject(FundingModerationService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly data = signal<SponsorMediaWorkspace | null>(null);
  readonly photos = () =>
    this.data()?.assets.filter((asset) => asset.kind === 'supporting_image') ??
    [];
  readonly selected = signal<SponsorMediaWorkspaceAsset | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly busy = signal(false);
  readonly previews = new MediaPreviewCollection(async (id, version) => {
    try {
      return await this.admin.mediaThumbnail(id, version);
    } catch (error) {
      if (
        error instanceof AdminDashboardRequestError &&
        [401, 403].includes(error.status)
      ) {
        this.clear();
        this.failed.set(true);
        if (error.status === 401) this.admin.clearAdminSession();
      }
      throw error;
    }
  });
  readonly fullPreview = new BlobPreviewResource();
  readonly fullFailed = signal(false);
  private pendingReview: ModerationRequest | null = null;
  private generation = 0;
  private disposed = false;
  readonly canReview = () => this.admin.identity()?.role !== 'reader';
  readonly t = (key: string) => this.i18n.t('admin.pilotage.' + key);
  constructor() {
    effect(() => {
      this.contributionId();
      this.refreshKey();
      this.admin.sessionGeneration();
      this.admin.identity();
      untracked(() => {
        this.clear();
        if (this.browser && this.admin.hasValidAdminSession()) void this.load();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      this.clear();
      this.previews.dispose();
      this.fullPreview.dispose();
    });
  }
  private clear(): void {
    if (this.pendingReview && this.moderation.pending() === this.pendingReview)
      this.moderation.answer(null);
    this.pendingReview = null;
    ++this.generation;
    this.data.set(null);
    this.selected.set(null);
    this.previews.clear();
    this.fullPreview.clear();
    this.workspaceChanged.emit(null);
  }
  enlarge(asset: SponsorMediaWorkspaceAsset): void {
    this.selected.set(asset);
    this.fullFailed.set(false);
    void this.fullPreview.load(
      () =>
        this.admin.getSponsorMediaPreview(
          this.admin.getSavedAdminToken(),
          asset.id
        ),
      (error) => {
        this.fullFailed.set(true);
        if (
          error instanceof AdminDashboardRequestError &&
          [401, 403].includes(error.status)
        )
          this.clear();
        if (error instanceof AdminDashboardRequestError && error.status === 401)
          this.admin.clearAdminSession();
      }
    );
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true);
    this.failed.set(false);
    try {
      const workspace = await this.admin.mediaWorkspace(this.contributionId());
      if (this.disposed || generation !== this.generation) return;
      this.data.set(workspace);
      this.workspaceChanged.emit(workspace);
      this.previews.retain(
        workspace.assets.map((asset) =>
          this.previews.key(asset.id, asset.version)
        )
      );
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.clear();
      this.failed.set(true);
      if (error instanceof AdminDashboardRequestError && error.status === 401)
        this.admin.clearAdminSession();
    } finally {
      if (!this.disposed && (generation === this.generation || this.failed()))
        this.loading.set(false);
    }
  }
  async disapprove(asset: SponsorMediaWorkspaceAsset): Promise<void> {
    if (
      this.disabled() ||
      this.busy() ||
      this.pendingReview ||
      !this.canReview()
    )
      return;
    const generation = this.generation;
    try {
      const subject = { type: 'media', id: asset.id } as const;
      const pending = this.moderation.requestDecision(subject, 'N3');
      this.pendingReview = this.moderation.pending();
      const decision = await pending;
      this.pendingReview = null;
      if (!decision || this.disposed || generation !== this.generation) return;
      this.busy.set(true);
      await this.admin.moderationDecision(subject, decision);
      if (!this.disposed && generation === this.generation) await this.load();
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.failed.set(true);
        if (
          error instanceof AdminDashboardRequestError &&
          [401, 403].includes(error.status)
        )
          this.clear();
        if (error instanceof AdminDashboardRequestError && error.status === 401)
          this.admin.clearAdminSession();
      }
    } finally {
      if (!this.disposed) this.busy.set(false);
    }
  }
}
