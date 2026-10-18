import { TranslatePipe } from '@ngx-translate/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal
} from '@angular/core';

import type { AdminSponsorDetailIdentityView } from '../../models/admin-sponsors-ui.models.js';
import { AdminSponsorMediaPreferenceComponent } from '../sponsor-media-usage/admin-sponsor-media-preference.component.js';
import { MediaReviewWorkspaceComponent } from '../media-review/media-review-workspace.component.js';

import { AdminSponsorLogoPanelComponent } from './detail-media/admin-sponsor-logo-panel.component.js';

@Component({
  selector: 'openg7-admin-sponsor-detail-media',
  standalone: true,
  imports: [
    TranslatePipe,
    AdminSponsorLogoPanelComponent,
    MediaReviewWorkspaceComponent,
    AdminSponsorMediaPreferenceComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="detail-body admin-focus-target"
      id="dossier-media"
      tabindex="-1"
      [attr.aria-label]="'admin.legacy.medias_du_commanditaire' | translate"
    >
      <details>
        <summary>{{ 'admin.legacy.logo_actuel' | translate }}</summary>
        <openg7-admin-sponsor-logo-panel
          [identity]="identity()"
          [disabled]="true"
          [hideControls]="true"
        />
      </details>
      @if (identity().contributionId; as contributionId) {
        <openg7-admin-sponsor-media-preference
          [contributionId]="contributionId"
          [disabled]="busy()"
          (busyChange)="preferenceBusy.set($event)"
          (changed)="moderationChanged.emit()"
        />
      }

      @if (identity().contributionId; as contributionId) {
        <openg7-media-review-workspace
          [contributionId]="contributionId"
          [disabled]="identity().mediaBusy || preferenceBusy()"
          (busyChange)="workspaceBusy.set($event)"
          (changed)="moderationChanged.emit()"
        />
      }
    </section>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-detail-media.component.css'
  ]
})
export class AdminSponsorDetailMediaComponent {
  readonly moderationChanged = output<void>();
  readonly identity = input.required<AdminSponsorDetailIdentityView>();
  readonly preferenceBusy = signal(false);
  readonly workspaceBusy = signal(false);
  readonly busy = computed(
    () =>
      this.identity().mediaBusy || this.workspaceBusy() || this.preferenceBusy()
  );
}
