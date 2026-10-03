import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import type {
  AdminSetupStatusResponse,
  CockpitSystem
} from '@openg7/funding-core';

import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import type { SetupReadiness, SetupSection } from './setup-projections.js';
import {
  SetupPresentation,
  type SetupEmailTestView
} from './setup-presentation.js';

/** Setup presentation section; the routed page owns state and effects. */
@Component({
  selector: 'openg7-admin-setup-services',
  standalone: true,
  imports: [TranslatePipe, AdminIconComponent, CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-setup-services.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-setup-presentation.css',
    './admin-setup-services.component.css'
  ]
})
export class AdminSetupServicesComponent {
  readonly setup = input.required<AdminSetupStatusResponse>();
  readonly readiness = input.required<SetupReadiness>();
  readonly storageSystem = input<CockpitSystem | undefined>();
  readonly emailTest = input.required<SetupEmailTestView>();
  readonly activeTourAnchor = input<string | null>(null);
  readonly emailChanged = output<string>();
  readonly sendEmailTest = output<void>();
  readonly checkEmailTest = output<void>();
  readonly inspect = output<SetupSection>();
  readonly labels = new SetupPresentation(inject(FundingI18nService));
  changeEmail(event: Event): void {
    this.emailChanged.emit(
      (event.target as HTMLInputElement | null)?.value ?? ''
    );
  }
}
