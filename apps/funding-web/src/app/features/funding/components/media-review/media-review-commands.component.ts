import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
  output,
  viewChild
} from '@angular/core';
import type {
  SponsorMediaWorkspaceAsset,
  SponsorMediaPreparationObligation
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';

import type { MediaReviewCommands } from './media-review-commands.js';
import type { MediaPreviewCollection } from './media-preview-collection.js';
import { MediaReviewThumbnailComponent } from './media-review-thumbnail.component.js';

interface MediaReviewCommandView {
  t(key: string, params?: Record<string, unknown>): string;
  assetName(id: string): string;
  reasonLabel(reason: string): string;
  effectLabel(effect: string): string;
  usageSummary(asset: Pick<SponsorMediaWorkspaceAsset, 'usage'>): string;
  value(event: Event): string;
  checked(event: Event): boolean;
  obligationLabel(obligation: SponsorMediaPreparationObligation): string;
  previewUrl(): string | null;
  previewFailed(): boolean;
}

/** Funding command surface: consent summary, review, batches and exact execution manifest. */
@Component({
  selector: 'openg7-media-review-commands',
  standalone: true,
  imports: [AdminDrawerComponent, MediaReviewThumbnailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-review-commands.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './media-review-common.css',
    './media-review-commands.component.css'
  ]
})
export class MediaReviewCommandsComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);
  private readonly decisionReason =
    viewChild<ElementRef<HTMLSelectElement>>('decisionReason');
  readonly commands = input.required<MediaReviewCommands>();
  readonly view = input.required<MediaReviewCommandView>();
  readonly thumbnails = input.required<MediaPreviewCollection>();
  readonly hasPendingConsent = input(false);
  readonly canRequestConsent = input(false);
  readonly consentRequested = output<void>();
  readonly i18n = inject(FundingI18nService);
  reviewReasons(asset: SponsorMediaWorkspaceAsset): readonly string[] {
    return asset.usage?.state === 'confirmed'
      ? asset.readiness.reasons
      : asset.readiness.reasons.filter(
          (reason) =>
            reason !== 'MEDIA_USAGE_CONFIRMATION_REQUIRED' &&
            reason !== 'MEDIA_USAGE_WITHDRAWN'
        );
  }
  openReviewRejection(asset: SponsorMediaWorkspaceAsset): void {
    const commands = this.commands();
    if (!commands.c.canWrite() || commands.reviewSubmitting()) return;
    commands.openReject(asset);
    if (!isPlatformBrowser(this.platformId)) return;
    afterNextRender(
      () => {
        if (
          commands.form() === 'reject' &&
          commands.rejectSingleId() === asset.id
        )
          this.decisionReason()?.nativeElement.focus();
      },
      { injector: this.injector }
    );
  }
  acceptanceDate(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(date)
      : this.view().t('acceptanceUnknownDate');
  }
}
