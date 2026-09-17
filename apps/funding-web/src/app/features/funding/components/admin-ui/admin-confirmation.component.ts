import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';

import { AdminDrawerComponent } from './admin-drawer.component.js';

@Component({
  selector: 'openg7-admin-confirmation',
  standalone: true,
  imports: [AdminDrawerComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-drawer
      [opened]="!!confirmation.pending()"
      [title]="'admin.confirmation.title' | translate"
      [closeLabel]="'admin.confirmation.cancel' | translate"
      (closed)="confirmation.answer(false)"
    >
      @if (confirmation.pending(); as decision) {
        <p>{{ decision.message }}</p>
        <p class="target">{{ decision.target }}</p>
        <footer>
          <button
            type="button"
            class="admin-button"
            (click)="confirmation.answer(false)"
          >
            {{ 'admin.confirmation.cancel' | translate }}
          </button>
          <button
            type="button"
            class="admin-button admin-button--primary"
            (click)="confirmation.answer(true)"
            data-og7="confirm-action"
          >
            {{ 'admin.confirmation.accept' | translate }}
          </button>
        </footer>
      }
    </openg7-admin-drawer>
  `,
  styleUrls: ['./admin-theme.css', './admin-controls.css'],
  styles: [
    'footer { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.5rem; } .target { overflow-wrap: anywhere; color: var(--admin-muted); }'
  ]
})
export class AdminConfirmationComponent {
  readonly confirmation = inject(AdminConfirmationService);
  constructor() {
    inject(DestroyRef).onDestroy(() => this.confirmation.answer(false));
  }
}
