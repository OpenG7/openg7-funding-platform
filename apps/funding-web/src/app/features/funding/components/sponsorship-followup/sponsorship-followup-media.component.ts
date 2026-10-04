import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnChanges,
  OnInit,
  PLATFORM_ID,
  type SimpleChanges,
  inject,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { SponsorMediaAsset, SponsorMediaKind } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingService } from '../../services/funding.service.js';
import {
  SponsorshipFollowupMediaController,
  type SponsorshipMediaUploadAttempt
} from '../../services/sponsorship-followup-media-controller.js';

@Component({
  selector: 'openg7-sponsorship-followup-media',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-followup-media.component.html',
  styleUrls: ['./sponsorship-followup.css']
})
export class SponsorshipFollowupMediaComponent implements OnInit, OnChanges {
  readonly token = input.required<string>();
  readonly canUploadMedia = input(false);
  readonly busyChange = output<boolean>();
  readonly i18n = inject(FundingI18nService);
  private readonly service = inject(FundingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly controller = new SponsorshipFollowupMediaController({
    service: this.service,
    token: () => this.token(),
    canUploadMedia: () => this.canUploadMedia(),
    isBrowser: () => isPlatformBrowser(this.platformId),
    busyChange: (value) => this.busyChange.emit(value),
    confirmDelete: () =>
      window.confirm(this.i18n.t('funding.followup.media.deleteConfirm'))
  });
  readonly assets = this.controller.assets;
  readonly attempts = this.controller.attempts;
  readonly previews = this.controller.previews;
  readonly limits = this.controller.limits;
  readonly busy = this.controller.busy;
  readonly loadError = this.controller.loadError;
  readonly loaded = this.controller.loaded;
  readonly message = this.controller.message;
  readonly altText = this.controller.altText;
  readonly hasActiveLogo = this.controller.hasActiveLogo;
  readonly hasApprovedLogo = this.controller.hasApprovedLogo;
  readonly photoCount = this.controller.photoCount;
  readonly canAddSupportingImage = this.controller.canAddSupportingImage;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.controller.dispose());
    void this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['token'] && !changes['token'].firstChange) void this.refresh();
  }

  refresh(): Promise<void> {
    return this.controller.refresh();
  }

  async uploadMedia(kind: SponsorMediaKind, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    try {
      await this.controller.uploadMedia(kind, files);
    } finally {
      input.value = '';
    }
  }

  deleteMedia(asset: SponsorMediaAsset): Promise<boolean> {
    return this.controller.deleteMedia(asset);
  }

  dismiss(attempt: SponsorshipMediaUploadAttempt): Promise<void> {
    return this.controller.dismiss(attempt);
  }

  setAltText(event: Event): void {
    this.controller.setAltText((event.target as HTMLInputElement).value);
  }

  size(bytes: number): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      maximumFractionDigits: 1
    }).format(bytes / (1024 * 1024));
  }
}
