import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminSponsorDetailIdentityView } from '../../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsor-logo-panel',
  standalone: true,
  imports: [TranslatePipe],
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
  readonly disabled = input(false);
  readonly uploadLogo = output<Event>();
  readonly deleteLogo = output<void>();
  readonly hasLogo = computed(() =>
    Boolean(this.identity().logoPreviewSource || this.identity().logoUrl)
  );

  onUploadLogo(event: Event): void {
    if (!this.disabled() && !this.identity().uploadDisabled) {
      this.uploadLogo.emit(event);
    }
  }

  onDeleteLogo(): void {
    if (!this.disabled() && !this.identity().deleteDisabled && this.hasLogo()) {
      this.deleteLogo.emit();
    }
  }
}
