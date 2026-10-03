import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminCockpitSystems, CockpitSystem } from '@openg7/funding-core';

import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import type { CockpitBlockState } from '../../components/admin-cockpit/cockpit-block.js';
import { AdminSystemCardsComponent } from '../../components/admin-cockpit/admin-system-cards.component.js';
import { AdminCockpitStatusComponent } from '../../components/admin-cockpit/admin-cockpit-status.component.js';

/** Setup presentation section; the routed page owns state and effects. */
@Component({
  selector: 'openg7-admin-setup-readiness',
  standalone: true,
  imports: [
    TranslatePipe,
    AdminIconComponent,
    AdminSystemCardsComponent,
    AdminCockpitStatusComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-setup-readiness.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-setup-presentation.css',
    './admin-setup-readiness.component.css'
  ]
})
export class AdminSetupReadinessComponent {
  readonly snapshot = input<AdminCockpitSystems | null>(null);
  readonly state = input.required<CockpitBlockState>();
  readonly stale = input(false);
  readonly failed = input(false);
  readonly now = input.required<number>();
  readonly operationalCount = input.required<number>();
  readonly tourTarget = input(false);
  readonly refresh = output<void>();
  readonly inspect = output<CockpitSystem['id']>();
}
