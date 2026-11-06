import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import type {
  AdminPreparationDraft,
  SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { BlobPreviewResource } from '../../services/blob-preview-resource.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import {
  SponsorPresentationCardComponent,
  type SponsorPresentationPhoto
} from '../sponsor-presentation-card/sponsor-presentation-card.component.js';
import { MediaReviewThumbnailComponent } from '../media-review/media-review-thumbnail.component.js';
import { MediaPreviewCollection } from '../media-review/media-preview-collection.js';

import {
  projectServiceMedia,
  type PreparedServiceMedia
} from './preflight-service-media.js';
import en from './preflight-service-preview.en.json' with { type: 'json' };
import fr from './preflight-service-preview.fr-CA.json' with { type: 'json' };

/** Private, read-only presentation; no preview can approve media or publish content. */
@Component({
  selector: 'openg7-preflight-service-preview',
  standalone: true,
  imports: [SponsorPresentationCardComponent, MediaReviewThumbnailComponent],
  templateUrl: './preflight-service-preview.component.html',
  styleUrl: './preflight-service-preview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreflightServicePreviewComponent {
  readonly companyName = input.required<string>();
  readonly draft = input<AdminPreparationDraft | null>(null);
  readonly contributionId = input.required<string>();
  readonly obligationId = input('');
  readonly channel = input<'website' | 'facebook' | 'linkedin'>('website');
  readonly target = input<'openg7' | 'openg20'>('openg7');
  readonly view = input<'preview' | 'media'>('preview');
  readonly navigationDisabled = input(false);
  readonly ownerRequested = output<'media' | 'delivery'>();
  readonly accessLost = output<401 | 403>();
  readonly viewport = input<'desktop' | 'tablet' | 'mobile'>('desktop');
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly photoResource = new BlobPreviewResource();
  private readonly logoResource = new BlobPreviewResource();
  readonly logoSource = this.logoResource.url;
  readonly loading = signal(false);
  readonly unavailable = signal(false);
  readonly selectedPhoto = signal<SponsorMediaWorkspaceAsset | null>(null);
  readonly selectedLogo = signal<SponsorMediaWorkspaceAsset | null>(null);
  readonly prepared = signal<readonly PreparedServiceMedia[]>([]);
  readonly usesPreparation = signal(false);
  readonly thumbnails = new MediaPreviewCollection((id) => {
    const ticket = this.generation;
    return this.admin.mediaThumbnail(id).catch((error: unknown) => {
      this.previewUnavailable(ticket, error);
      throw error;
    });
  });
  readonly imageFailedSources = signal<ReadonlySet<string>>(new Set());
  readonly photo = computed<SponsorPresentationPhoto | null>(() => {
    const asset = this.selectedPhoto(),
      url = this.photoResource.url();
    return asset && url && !this.imageFailedSources().has(url)
      ? {
          url,
          alt: asset.altText ?? '',
          width: asset.width,
          height: asset.height,
          credit: asset.usage?.credit
        }
      : null;
  });
  readonly visibleLogo = computed(() => {
    const url = this.logoSource();
    return url && !this.imageFailedSources().has(url) ? url : null;
  });
  private generation = 0;
  private destroyed = false;

  constructor() {
    this.i18n.mergeTranslations('fr-CA', { admin: { preflightPreview: fr } });
    this.i18n.mergeTranslations('en', { admin: { preflightPreview: en } });
    effect(() => {
      const id = this.contributionId(),
        channel = this.channel(),
        target = this.target(),
        obligationId = this.obligationId(),
        view = this.view();
      const draft = this.draft();
      const session = this.admin.sessionGeneration();
      const revision = this.admin.dataRevision();
      untracked(() => {
        void session;
        void revision;
        void this.load(id, channel, draft, obligationId, view, target);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      ++this.generation;
      this.photoResource.dispose();
      this.logoResource.dispose();
      this.thumbnails.dispose();
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.preflightPreview.' + key, params);
  }
  imageFailed(url: string): void {
    this.imageFailedSources.update((sources) => new Set([...sources, url]));
    this.unavailable.set(true);
  }

  private async load(
    id: string,
    channel: 'website' | 'facebook' | 'linkedin',
    draft: AdminPreparationDraft | null,
    obligationId: string,
    view: 'preview' | 'media',
    target: 'openg7' | 'openg20'
  ): Promise<void> {
    const ticket = ++this.generation;
    this.photoResource.clear();
    this.logoResource.clear();
    this.selectedPhoto.set(null);
    this.selectedLogo.set(null);
    this.prepared.set([]);
    this.usesPreparation.set(false);
    this.thumbnails.clear();
    this.imageFailedSources.set(new Set());
    this.loading.set(false);
    this.unavailable.set(false);
    if (
      !this.browser ||
      !this.admin.hasValidAdminSession() ||
      !id ||
      (view === 'preview' && !draft)
    )
      return;
    this.loading.set(true);
    try {
      const data = await this.admin.mediaWorkspace(id);
      if (!this.current(ticket)) return;
      if (data.contributionId !== id) throw new Error('MEDIA_SCOPE_MISMATCH');
      const projection = projectServiceMedia(
        data,
        id,
        obligationId,
        channel,
        target
      );
      this.prepared.set(projection.prepared);
      this.usesPreparation.set(projection.usesPreparation);
      if (projection.prepared.some((item) => item.stale || !item.eligible))
        this.unavailable.set(true);
      const assets = projection.previewAssets;
      const photo =
        assets.find((asset) => asset.kind === 'supporting_image') ?? null;
      const logo = assets.find((asset) => asset.kind === 'logo') ?? null;
      this.selectedPhoto.set(photo);
      this.selectedLogo.set(logo);
      if (view === 'media') return;
      const token = this.admin.getSavedAdminToken();
      await Promise.all([
        this.photoResource.load(
          photo
            ? () => this.admin.getSponsorMediaPreview(token, photo.id)
            : null,
          (error) => this.previewUnavailable(ticket, error)
        ),
        this.logoResource.load(
          logo ? () => this.admin.getSponsorMediaPreview(token, logo.id) : null,
          (error) => this.previewUnavailable(ticket, error)
        )
      ]);
    } catch (error) {
      this.previewUnavailable(ticket, error);
    } finally {
      if (this.current(ticket)) this.loading.set(false);
    }
  }

  private previewUnavailable(ticket: number, error?: unknown): void {
    if (!this.current(ticket)) return;
    if (
      error instanceof AdminDashboardRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      this.prepared.set([]);
      this.selectedPhoto.set(null);
      this.selectedLogo.set(null);
      this.photoResource.clear();
      this.logoResource.clear();
      this.thumbnails.clear();
      this.accessLost.emit(error.status);
      if (error.status === 401) this.admin.clearAdminSession();
    }
    this.unavailable.set(true);
  }
  private current(ticket: number): boolean {
    return (
      !this.destroyed &&
      ticket === this.generation &&
      this.admin.hasValidAdminSession()
    );
  }
}
