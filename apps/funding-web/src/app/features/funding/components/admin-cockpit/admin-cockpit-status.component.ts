import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { CockpitBlockState } from './cockpit-block.js';

@Component({
  selector: 'openg7-admin-cockpit-status',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() !== 'ready') {
      <p [attr.role]="state() === 'loading' ? 'status' : 'alert'">
        {{ 'admin.cockpit.state.' + state() | translate }}
      </p>
    }
    @if (stale()) {
      <p role="status">{{ 'admin.cockpit.stale' | translate }}</p>
    }
    <button
      type="button"
      class="admin-button"
      [attr.aria-label]="refreshLabel()"
      [disabled]="state() === 'loading'"
      (click)="refresh.emit()"
    >
      {{ 'admin.dashboard.refresh' | translate }}
    </button>
  `,
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-cockpit-status.component.css'
  ]
})
export class AdminCockpitStatusComponent {
  readonly state = input.required<CockpitBlockState>();
  readonly stale = input(false);
  readonly refreshLabel = input<string | null>(null);
  readonly refresh = output<void>();
}
