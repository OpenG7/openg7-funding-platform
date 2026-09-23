import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ContributionActivityService } from '../../services/contribution-activity.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';

@Component({
  selector: 'openg7-contribution-activity',
  standalone: true,
  imports: [RouterLink, TranslatePipe, AdminDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './contribution-activity.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './contribution-activity.component.css'
  ]
})
export class ContributionActivityComponent {
  readonly activity = inject(ContributionActivityService);
  readonly i18n = inject(FundingI18nService);
  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const disconnect = this.activity.connect();
      destroy.onDestroy(disconnect);
    });
  }
  amount(value: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency
    }).format(value / 100);
  }
  date(value: string): string {
    return new Date(value).toLocaleString(this.i18n.currentLanguage());
  }
}
