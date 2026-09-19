import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  SponsorMediaAsset,
  SponsorMediaKind,
  SponsorMediaLimits
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingService } from '../../services/funding.service.js';
import {
  getSponsorMediaFileValidationFeedback,
  getSponsorMediaUploadFailureFeedback,
  type SponsorMediaFeedback
} from '../../services/sponsor-media-upload-feedback.js';

interface UploadAttempt {
  readonly id: number;
  readonly filename: string;
  readonly previewUrl: string;
  readonly status: 'queued' | 'uploading' | 'uploaded' | 'failed';
  readonly feedback: SponsorMediaFeedback;
  readonly asset?: SponsorMediaAsset;
}

@Component({
  selector: 'openg7-sponsorship-followup-media',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-followup-media.component.html',
  styleUrls: ['./sponsorship-followup.css']
})
export class SponsorshipFollowupMediaComponent implements OnInit {
  readonly token = input.required<string>();
  readonly canUploadMedia = input(false);
  readonly busyChange = output<boolean>();
  readonly i18n = inject(FundingI18nService);
  private readonly service = inject(FundingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  readonly assets = signal<readonly SponsorMediaAsset[]>([]);
  readonly attempts = signal<readonly UploadAttempt[]>([]);
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
  readonly hasActiveLogo = computed(() =>
    this.assets().some((asset) => asset.kind === 'logo')
  );
  readonly hasApprovedLogo = computed(() =>
    this.assets().some(
      (asset) => asset.kind === 'logo' && asset.reviewStatus === 'approved'
    )
  );
  readonly photoCount = computed(
    () =>
      this.assets().filter((asset) => asset.kind === 'supporting_image').length
  );
  readonly canAddSupportingImage = computed(
    () => this.photoCount() < this.limits().maxSupportingImages
  );
  private sequence = 0;
  private readSequence = 0;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.readSequence++;
      this.revoke(Object.values(this.previews()));
      this.revoke(this.attempts().map((attempt) => attempt.previewUrl));
    });
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.setBusy(true);
    try {
      await this.loadMedia();
    } finally {
      this.setBusy(false);
    }
  }

  async uploadMedia(kind: SponsorMediaKind, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (
      !files.length ||
      this.busy() ||
      !this.canUploadMedia() ||
      !this.loaded()
    )
      return;
    if (kind === 'logo' && this.hasApprovedLogo()) return;
    const available =
      kind === 'logo'
        ? 1
        : Math.max(0, this.limits().maxSupportingImages - this.photoCount());
    const attempts: UploadAttempt[] = files.map((file) => ({
      id: ++this.sequence,
      filename: file.name,
      previewUrl:
        isPlatformBrowser(this.platformId) &&
        file.type.startsWith('image/') &&
        file.size > 0
          ? URL.createObjectURL(file)
          : '',
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
        if (this.destroyRef.destroyed) return;
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
        this.updateAttempt(attempt.id, {
          status: 'uploading',
          feedback: { key: 'uploading' }
        });
        try {
          const result = await this.service.uploadSponsorshipMedia(
            this.token(),
            kind,
            file,
            this.altText()
          );
          if (this.destroyRef.destroyed) return;
          accepted++;
          uploaded.push(attempt.id);
          this.updateAttempt(attempt.id, {
            status: 'uploaded',
            asset: result.asset,
            feedback: { key: 'uploaded' }
          });
        } catch (error) {
          if (this.destroyRef.destroyed) return;
          failed++;
          this.updateAttempt(attempt.id, {
            status: 'failed',
            feedback: getSponsorMediaUploadFailureFeedback(error, this.limits())
          });
        }
      }
      if (uploaded.length && (await this.loadMedia())) {
        this.removeAttempts(uploaded);
        this.altText.set('');
      }
      if (!this.destroyRef.destroyed)
        this.message.set({
          key: 'result',
          params: { received: accepted, failed }
        });
    } finally {
      if (!this.destroyRef.destroyed) this.setBusy(false);
      input.value = '';
    }
  }

  async deleteMedia(asset: SponsorMediaAsset): Promise<boolean> {
    if (
      this.busy() ||
      !this.canUploadMedia() ||
      asset.reviewStatus === 'approved'
    )
      return false;
    if (
      !isPlatformBrowser(this.platformId) ||
      !window.confirm(this.i18n.t('funding.followup.media.deleteConfirm'))
    )
      return false;
    this.setBusy(true);
    try {
      const result = await this.service.deleteSponsorshipMedia({
        token: this.token(),
        assetId: asset.id,
        expectedVersion: asset.version
      });
      if (this.destroyRef.destroyed) return false;
      if (!result.deleted) throw new Error('Deletion not confirmed.');
      this.assets.update((assets) =>
        assets.filter((item) => item.id !== asset.id)
      );
      this.message.set({ key: 'deleted' });
      await this.loadMedia();
      return true;
    } catch {
      if (!this.destroyRef.destroyed) this.message.set({ key: 'deleteError' });
      return false;
    } finally {
      if (!this.destroyRef.destroyed) this.setBusy(false);
    }
  }

  async dismiss(attempt: UploadAttempt): Promise<void> {
    if (this.busy()) return;
    if (attempt.asset && !(await this.deleteMedia(attempt.asset))) return;
    this.removeAttempts([attempt.id]);
  }

  setAltText(event: Event): void {
    this.altText.set((event.target as HTMLInputElement).value.slice(0, 300));
  }
  size(bytes: number): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      maximumFractionDigits: 1
    }).format(bytes / (1024 * 1024));
  }

  private async loadMedia(): Promise<boolean> {
    const sequence = ++this.readSequence;
    this.loadError.set(false);
    try {
      const response = await this.service.getSponsorshipMedia(this.token());
      if (this.destroyRef.destroyed || sequence !== this.readSequence)
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
      await this.loadPreviews(response.assets, sequence);
      return !this.destroyRef.destroyed;
    } catch {
      if (!this.destroyRef.destroyed && sequence === this.readSequence)
        this.loadError.set(true);
      return false;
    }
  }

  private async loadPreviews(
    assets: readonly SponsorMediaAsset[],
    sequence: number
  ): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    const entries = await Promise.all(
      assets.map(async (asset) => {
        try {
          const blob = await this.service.getSponsorshipMediaPreview(
            this.token(),
            asset.id
          );
          if (this.destroyRef.destroyed || sequence !== this.readSequence)
            return null;
          return [asset.id, URL.createObjectURL(blob)] as const;
        } catch {
          return null;
        }
      })
    );
    const previews = Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, string] => entry !== null
      )
    );
    if (this.destroyRef.destroyed || sequence !== this.readSequence) {
      this.revoke(Object.values(previews));
      return;
    }
    this.revoke(Object.values(this.previews()));
    this.previews.set(previews);
  }

  private updateAttempt(id: number, update: Partial<UploadAttempt>): void {
    this.attempts.update((attempts) =>
      attempts.map((attempt) =>
        attempt.id === id ? { ...attempt, ...update } : attempt
      )
    );
  }
  private removeAttempts(ids: readonly number[]): void {
    this.revoke(
      this.attempts()
        .filter((attempt) => ids.includes(attempt.id))
        .map((attempt) => attempt.previewUrl)
    );
    this.attempts.update((attempts) =>
      attempts.filter((attempt) => !ids.includes(attempt.id))
    );
  }
  private revoke(urls: readonly string[]): void {
    if (isPlatformBrowser(this.platformId))
      urls.filter(Boolean).forEach((url) => URL.revokeObjectURL(url));
  }
  private setBusy(value: boolean): void {
    this.busy.set(value);
    this.busyChange.emit(value);
  }
}
