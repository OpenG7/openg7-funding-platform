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
      [disabled]="state() === 'loading'"
      (click)="refresh.emit()"
    >
      {{ 'admin.dashboard.refresh' | translate }}
    </button>
  `,
  styleUrls: ['../admin-ui/admin-controls.css'],
  styles: [
    ':host { display: block; color: var(--admin-muted); font-size: .8rem; } p { margin: .5rem 0; }'
  ]
})
export class AdminCockpitStatusComponent {
  readonly state = input.required<CockpitBlockState>();
  readonly stale = input(false);
  readonly refresh = output<void>();
}
