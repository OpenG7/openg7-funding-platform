import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';

import type { ContributionRowView } from './admin-contributions-view.js';

@Component({
  selector: 'openg7-admin-contributions-detail',
  standalone: true,
  imports: [CommonModule, TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-contributions-detail.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-contributions-detail.component.css'
  ]
})
export class AdminContributionsDetailComponent {
  readonly contribution = input.required<ContributionRowView>();
  readonly followPayment = output<string>();
}
