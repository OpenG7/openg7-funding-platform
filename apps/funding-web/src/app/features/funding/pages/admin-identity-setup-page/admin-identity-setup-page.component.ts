import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminIdentitySetupComponent } from '../../components/admin-identity-setup/admin-identity-setup.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Public instructions only; authenticated diagnostics remain in the owner setup. */
@Component({
  selector: 'openg7-admin-identity-setup-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe, AdminIdentitySetupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-identity-setup-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-identity-setup-page.component.css'
  ]
})
export class AdminIdentitySetupPageComponent {
  readonly i18n = inject(FundingI18nService);
  readonly setupReturn = {
    returnUrl: '/admin/fundraiser/setup?section=identity'
  };
}
