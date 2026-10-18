import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { MediaReviewHistory } from './media-review-history.js';

/** Private inspector timeline. Opening or paginating never issues a business command. */
@Component({
  selector: 'details[openg7-media-review-history]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-review-history.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './media-review-history.component.css'
  ],
  host: { '(toggle)': 'history().historyOpened($event)' }
})
export class MediaReviewHistoryComponent {
  readonly history = input.required<MediaReviewHistory>();
  readonly view = input.required<{
    t(key: string, params?: Record<string, unknown>): string;
  }>();
}
