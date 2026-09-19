import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Funding presentation molecule: displays formatted public amounts and their freshness. */
@Component({
  selector: 'openg7-funding-finance-summary',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-finance-summary.component.html',
  styles: [':host { display: block; min-width: 0; }']
})
export class FundingFinanceSummaryComponent {
  private readonly i18n = inject(FundingI18nService);
  readonly received = input.required<string>();
  readonly fees = input.required<string>();
  readonly available = input.required<string>();
  readonly error = input(false);
  readonly statusLabel = input.required<string>();
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
}
