import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingModerationActionsComponent } from '../../admin-moderation/funding-moderation-actions.component.js';
import { AdminSponsorMediaUsageComponent } from '../../sponsor-media-usage/admin-sponsor-media-usage.component.js';
import { AdminAutomaticPreparationDirective } from '../../admin-automatic/admin-automatic-preparation.directive.js';
import type {
  AdminSponsorMediaAssetView,
  AdminSponsorMediaDeleteEvent,
  AdminSponsorMediaReviewEvent
} from '../../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsor-media-card',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    FundingModerationActionsComponent,
    AdminSponsorMediaUsageComponent,
    AdminAutomaticPreparationDirective
  ],
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
  readonly restrictionsChange = output<boolean>();
  readonly busyChange = output<boolean>();
  readonly usageBusy = signal(false);
  readonly restrictionsConfirmed = signal(false);
  private restrictionsVersion = '';
  readonly busy = computed(() => this.mediaBusy() || this.usageBusy());
  readonly usageReady = computed(
    () =>
      this.asset().usage?.state === 'confirmed' &&
      (!this.asset().usage?.restrictions ||
        this.asset().usageRestrictionsReviewed ||
        (this.restrictionsConfirmed() &&
          this.restrictionsVersion === this.asset().version))
  );
  constructor() {
    effect(() => {
      const version = this.asset().version;
      untracked(() => {
        this.restrictionsVersion = version;
        this.restrictionsConfirmed.set(false);
        this.restrictionsChange.emit(false);
      });
    });
  }
  confirmRestrictions(event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.restrictionsConfirmed.set(value);
    this.restrictionsChange.emit(value);
  }
  approve(): void {
    if (!this.busy() && this.usageReady())
      this.reviewMedia.emit({
        assetId: this.asset().id,
        expectedVersion: this.asset().version,
        reviewStatus: 'approved',
        altText: this.altText(),
        ...(this.restrictionsConfirmed()
          ? { usageRestrictionsConfirmed: true as const }
          : {})
      });
  }
  setUsageBusy(value: boolean): void {
    this.usageBusy.set(value);
    this.busyChange.emit(value);
  }

  setAltText(event: Event): void {
    this.altTextChange.emit((event.target as HTMLInputElement).value);
  }
}
