import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'openg7-admin-contributions-export',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-contributions-export.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-contributions-export.component.css'
  ]
})
export class AdminContributionsExportComponent {
  readonly count = input.required<number>();
  readonly canExport = input.required<boolean>();
  readonly errorKey = input.required<string>();
}
