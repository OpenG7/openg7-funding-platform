import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';

import type { PublicationAutomationSettingsController } from './publication-automation-settings.controller.js';

/** Funding organism: destination links and global worker switch. */
@Component({
  selector: 'openg7-admin-publication-automation-settings',
  standalone: true,
  imports: [RouterLink, TranslatePipe, FormsModule, AdminDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-publication-automation-settings.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-publication-automation-settings.component.css'
  ]
})
export class AdminPublicationAutomationSettingsComponent {
  readonly controller =
    input.required<PublicationAutomationSettingsController>();
  readonly feedSettingsExpanded = input(false);
}
