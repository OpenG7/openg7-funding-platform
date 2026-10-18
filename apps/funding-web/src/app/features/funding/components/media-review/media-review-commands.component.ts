import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import type { SponsorMediaWorkspaceAsset } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import { SponsorMediaUsageEditorComponent } from '../sponsor-media-usage/sponsor-media-usage-editor.component.js';

import type { MediaReviewCommands } from './media-review-commands.js';
import type { MediaPreviewCollection } from './media-preview-collection.js';
import { MediaReviewThumbnailComponent } from './media-review-thumbnail.component.js';

interface MediaReviewCommandView {
  t(key: string, params?: Record<string, unknown>): string;
  assetName(id: string): string;
  reasonLabel(reason: string): string;
  usageSummary(asset: Pick<SponsorMediaWorkspaceAsset, 'usage'>): string;
  value(event: Event): string;
  checked(event: Event): boolean;
}

/** Funding command surface: scoped rights, batches, rejection and the exact execution manifest. */
@Component({
  selector: 'openg7-media-review-commands',
  standalone: true,
  imports: [
    AdminDrawerComponent,
    SponsorMediaUsageEditorComponent,
    MediaReviewThumbnailComponent
  ],
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
  readonly commands = input.required<MediaReviewCommands>();
  readonly view = input.required<MediaReviewCommandView>();
  readonly thumbnails = input.required<MediaPreviewCollection>();
  readonly i18n = inject(FundingI18nService);
}
