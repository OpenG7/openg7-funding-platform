import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Router, RouterLink } from '@angular/router';

import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';

import type { SetupRecommendation, SetupSection } from './setup-projections.js';

/** Setup presentation section; the routed page owns state and effects. */
@Component({
  selector: 'openg7-admin-setup-recommendation',
  standalone: true,
  imports: [TranslatePipe, AdminIconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-setup-recommendation.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-setup-presentation.css',
    './admin-setup-recommendation.component.css'
  ]
})
export class AdminSetupRecommendationComponent {
  readonly router = inject(Router);
  readonly recommendation = input.required<SetupRecommendation>();
  readonly inspect = output<SetupSection>();
}
