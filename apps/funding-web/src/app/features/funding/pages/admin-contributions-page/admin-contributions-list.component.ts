import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import type { ContributionRowView } from './admin-contributions-view.js';

@Component({
  selector: 'openg7-admin-contributions-list',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-contributions-list.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-contributions-list.component.css'
  ]
})
export class AdminContributionsListComponent {
  readonly rows = input.required<readonly ContributionRowView[]>();
  readonly selectedId = input.required<string | null>();
  readonly updatedAtLabel = input.required<string>();
  readonly selected = output<string>();

  trackByContribution(_: number, contribution: ContributionRowView): string {
    return contribution.id;
  }
}
