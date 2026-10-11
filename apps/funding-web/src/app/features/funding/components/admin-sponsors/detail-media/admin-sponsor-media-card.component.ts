import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingModerationActionsComponent } from '../../admin-moderation/funding-moderation-actions.component.js';
import type {
  AdminSponsorMediaAssetView,
  AdminSponsorMediaDeleteEvent,
  AdminSponsorMediaReviewEvent
} from '../../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsor-media-card',
  standalone: true,
  imports: [CommonModule, TranslatePipe, FundingModerationActionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-media-card.component.html',
  styleUrls: [
    '../../admin-ui/admin-theme.css',
    '../../admin-ui/admin-controls.css',
    '../../admin-ui/admin-forms.css',
    './admin-sponsor-media-card.component.css'
  ]
})
export class AdminSponsorMediaCardComponent {
  readonly asset = input.required<AdminSponsorMediaAssetView>();
  readonly altText = input.required<string>();
  readonly mediaBusy = input.required<boolean>();
  readonly altTextChange = output<string>();
  readonly previewMedia = output<{ id: string; alt: string }>();
  readonly reviewMedia = output<AdminSponsorMediaReviewEvent>();
  readonly deleteMedia = output<AdminSponsorMediaDeleteEvent>();
  readonly moderationChanged = output<void>();

  setAltText(event: Event): void {
    this.altTextChange.emit((event.target as HTMLInputElement).value);
  }
}
