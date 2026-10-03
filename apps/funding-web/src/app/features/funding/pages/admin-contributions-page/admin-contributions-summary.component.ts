import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminContributionsResponse } from '@openg7/funding-core';

@Component({
  selector: 'openg7-admin-contributions-summary',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-contributions-summary.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-contributions-summary.component.css'
  ]
})
export class AdminContributionsSummaryComponent {
  readonly summary = input.required<AdminContributionsResponse['summary']>();
  readonly totalReceivedLabel = input.required<string>();
}
