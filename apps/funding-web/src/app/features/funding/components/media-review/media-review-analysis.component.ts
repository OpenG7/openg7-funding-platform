import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import {
  SPONSOR_MEDIA_CLASSIFICATIONS,
  type SponsorMediaClassification,
  type SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import type { MediaReviewAnalysis } from './media-review-analysis.js';
import type { MediaReviewWorkspaceController } from './media-review-workspace.controller.js';

/** Funding inspector surface: suggestions and explicit review, independent of media approval. */
@Component({
  selector: 'details[openg7-media-review-analysis]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-review-analysis.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './media-review-analysis.component.css'
  ]
})
export class MediaReviewAnalysisComponent {
  readonly analysis = input.required<MediaReviewAnalysis>();
  readonly controller = input.required<MediaReviewWorkspaceController>();
  readonly asset = input.required<SponsorMediaWorkspaceAsset>();
  readonly view = input.required<{
    t(key: string, params?: Record<string, unknown>): string;
  }>();
  readonly classifications = SPONSOR_MEDIA_CLASSIFICATIONS;
  readonly classification = computed(
    () => this.controller().draft(this.asset()).classification
  );
  changeClassification(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (this.classifications.includes(value as SponsorMediaClassification))
      this.controller().edit(this.asset(), {
        classification: value as SponsorMediaClassification
      });
  }
}
