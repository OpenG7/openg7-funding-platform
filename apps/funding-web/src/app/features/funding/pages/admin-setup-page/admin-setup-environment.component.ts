import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import type { AdminSetupStatusResponse } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { SetupPresentation, type SetupEnvRow } from './setup-presentation.js';

/** Setup presentation section; the routed page owns state and effects. */
@Component({
  selector: 'openg7-admin-setup-environment',
  standalone: true,
  imports: [TranslatePipe, CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-setup-environment.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-setup-presentation.css',
    './admin-setup-environment.component.css'
  ]
})
export class AdminSetupEnvironmentComponent {
  readonly setup = input.required<AdminSetupStatusResponse>();
  readonly tourTarget = input(false);
  readonly labels = new SetupPresentation(inject(FundingI18nService));
  trackByEnvRow(_index: number, row: SetupEnvRow): string {
    return row.key;
  }
}
