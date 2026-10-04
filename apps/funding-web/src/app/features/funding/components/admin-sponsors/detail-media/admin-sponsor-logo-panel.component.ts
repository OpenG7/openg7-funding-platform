import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminSponsorDetailIdentityView } from '../../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsor-logo-panel',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-logo-panel.component.html',
  styleUrls: [
    '../../admin-ui/admin-theme.css',
    '../../admin-ui/admin-controls.css',
    '../../admin-ui/admin-forms.css',
    './admin-sponsor-logo-panel.component.css'
  ]
})
export class AdminSponsorLogoPanelComponent {
  readonly identity = input.required<AdminSponsorDetailIdentityView>();
  readonly uploadLogo = output<Event>();
  readonly deleteLogo = output<void>();
}
